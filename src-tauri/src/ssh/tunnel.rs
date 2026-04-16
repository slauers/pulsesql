use crate::connection::types::{ConnectionConfig, SshAuthMethod};
use ssh2::{Channel, Session};
use std::io::{self, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SSH_SESSION_TIMEOUT_MS: u32 = 10_000;
const SSH_KEEPALIVE_INTERVAL_SECS: u32 = 30;

pub struct SshTunnelHandle {
    local_port: u16,
    stop_tx: Sender<()>,
    join_handle: Option<JoinHandle<()>>,
}

impl SshTunnelHandle {
    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }
}

pub fn start_ssh_tunnel(config: &ConnectionConfig) -> Result<SshTunnelHandle, String> {
    let ssh = config
        .ssh
        .as_ref()
        .filter(|ssh| ssh.enabled)
        .ok_or_else(|| "SSH is not enabled for this connection".to_string())?;

    let ssh_host = ssh
        .host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "SSH host is required".to_string())?;
    let ssh_port = ssh.port.unwrap_or(22);
    let ssh_user = ssh
        .user
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "SSH user is required".to_string())?;
    let auth_method = ssh.auth_method.clone().unwrap_or(SshAuthMethod::Password);

    let tcp = connect_ssh_stream(ssh_host, ssh_port)?;
    let mut session =
        Session::new().map_err(|error| format!("Failed to create SSH session: {error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(SSH_SESSION_TIMEOUT_MS);
    session.set_blocking(true);
    session
        .handshake()
        .map_err(|error| format!("SSH handshake failed: {error}"))?;

    match auth_method {
        SshAuthMethod::Password => {
            let password = ssh.password.as_deref().ok_or_else(|| {
                "SSH password is required for password authentication".to_string()
            })?;

            session
                .userauth_password(ssh_user, password)
                .map_err(|error| format!("SSH password authentication failed: {error}"))?;
        }
        SshAuthMethod::PrivateKey => {
            let private_key_path = ssh
                .private_key_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Private key path is required".to_string())?;

            session
                .userauth_pubkey_file(
                    ssh_user,
                    None,
                    Path::new(private_key_path),
                    ssh.passphrase.as_deref(),
                )
                .map_err(|error| format!("SSH private key authentication failed: {error}"))?;
        }
    }

    if !session.authenticated() {
        return Err("SSH authentication failed".into());
    }

    let db_host = config.host.clone();
    let db_port = config.port;

    probe_remote_target(&session, &db_host, db_port)?;
    session.set_timeout(0);
    session.set_keepalive(true, SSH_KEEPALIVE_INTERVAL_SECS);

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Failed to bind local tunnel port: {error}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to inspect local tunnel port: {error}"))?
        .port();

    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Failed to configure local tunnel listener: {error}"))?;

    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let join_handle = thread::spawn(move || {
        let mut last_keepalive = std::time::Instant::now();

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // libssh2 does not send keepalives automatically — the application must
            // call keepalive_send() at the configured interval to prevent the SSH
            // server (or intermediate NAT/firewall) from closing the idle connection.
            if last_keepalive.elapsed().as_secs() >= SSH_KEEPALIVE_INTERVAL_SECS as u64 {
                if let Err(error) = session.keepalive_send() {
                    eprintln!("SSH keepalive failed: {error}");
                }
                last_keepalive = std::time::Instant::now();
            }

            match listener.accept() {
                Ok((client_stream, _)) => {
                    let _ = client_stream.set_nodelay(true);

                    match session.channel_direct_tcpip(&db_host, db_port, None) {
                        Ok(channel) => {
                            thread::spawn(move || {
                                proxy_connection(client_stream, channel);
                            });
                        }
                        Err(error) => {
                            eprintln!(
                                "SSH direct-tcpip open failed for {}:{}: {}",
                                db_host, db_port, error
                            );
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => {
                    eprintln!("SSH tunnel listener error: {error}");
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
    });

    Ok(SshTunnelHandle {
        local_port,
        stop_tx,
        join_handle: Some(join_handle),
    })
}

fn connect_ssh_stream(ssh_host: &str, ssh_port: u16) -> Result<TcpStream, String> {
    let address = resolve_socket_addr(ssh_host, ssh_port)?;
    let stream = TcpStream::connect_timeout(&address, SSH_CONNECT_TIMEOUT)
        .map_err(|error| format!("Failed to connect to SSH host {address}: {error}"))?;

    let _ = stream.set_nodelay(true);

    Ok(stream)
}

fn resolve_socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Failed to resolve SSH host {host}:{port}: {error}"))?
        .next()
        .ok_or_else(|| format!("No socket address resolved for SSH host {host}:{port}"))
}

fn probe_remote_target(session: &Session, db_host: &str, db_port: u16) -> Result<(), String> {
    let mut channel = session
        .channel_direct_tcpip(db_host, db_port, None)
        .map_err(|error| {
            format!("SSH tunnel could not reach database target {db_host}:{db_port}: {error}")
        })?;

    let _ = channel.send_eof();
    let _ = channel.close();
    let _ = channel.wait_close();

    Ok(())
}

fn proxy_connection(client_stream: TcpStream, channel: Channel) {
    let mut client_reader = match client_stream.try_clone() {
        Ok(stream) => stream,
        Err(error) => {
            eprintln!("Failed to clone local tunnel socket: {error}");
            return;
        }
    };
    let mut client_writer = client_stream;
    let mut channel_reader = channel;
    let mut channel_writer = channel_reader.clone();
    let mut channel_control = channel_reader.clone();

    let upstream = thread::spawn(move || {
        let _ = io::copy(&mut client_reader, &mut channel_writer);
        let _ = channel_writer.flush();
        let _ = channel_writer.send_eof();
    });

    let downstream = thread::spawn(move || {
        let _ = io::copy(&mut channel_reader, &mut client_writer);
        let _ = client_writer.shutdown(Shutdown::Write);
    });

    let _ = upstream.join();
    let _ = downstream.join();
    let _ = channel_control.close();
    let _ = channel_control.wait_close();
}
