use crate::connection::types::{ConnectionConfig, SshAuthMethod};
use ssh2::Session;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const SSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SSH_SESSION_TIMEOUT_MS: u32 = 10_000;
const SSH_KEEPALIVE_INTERVAL_SECS: u32 = 30;

/// ssh2::ErrorCode returned when an operation would block in non-blocking mode.
const SSH_EAGAIN: ssh2::ErrorCode = ssh2::ErrorCode::Session(-37);

/// Max event-loop iterations spent retrying channel_direct_tcpip for one
/// accepted TCP connection (~2 s at 1 ms/iter).
const CHANNEL_OPEN_MAX_RETRIES: u32 = 2_000;

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

// ── per-connection state ──────────────────────────────────────────────────────

/// A TCP connection that is waiting for its SSH direct-tcpip channel to be
/// opened (channel_direct_tcpip may return EAGAIN in non-blocking mode).
struct PendingConn {
    stream: TcpStream,
    retries: u32,
}

/// An active proxied connection: one local TCP client ↔ one SSH channel.
///
/// All I/O runs in the single tunnel-loop thread, so there is no shared
/// `ssh2::Session` mutex contention between concurrent channel read/write
/// calls.  This prevents the deadlock that occurred with the previous
/// two-thread approach when Oracle's TNS listener issued a RESEND packet
/// (which required writing the retransmitted CONNECT before reading Oracle's
/// response — impossible while the downstream thread held the mutex in a
/// blocking read).
struct ProxyConn {
    client: TcpStream,
    channel: ssh2::Channel,
    /// Data read from the client, pending write to the SSH channel.
    to_channel: Vec<u8>,
    /// Data read from the SSH channel, pending write to the client.
    to_client: Vec<u8>,
    /// client.read() returned Ok(0) — client closed its write side.
    client_read_eof: bool,
    /// channel.send_eof() was called after the buffer was fully flushed.
    channel_eof_sent: bool,
    /// channel.read() returned Ok(0) — remote closed its write side.
    channel_read_eof: bool,
    /// client.shutdown(Write) was called after the buffer was fully flushed.
    client_shutdown_sent: bool,
}

impl ProxyConn {
    fn new(client: TcpStream, channel: ssh2::Channel) -> Self {
        Self {
            client,
            channel,
            to_channel: Vec::new(),
            to_client: Vec::new(),
            client_read_eof: false,
            channel_eof_sent: false,
            channel_read_eof: false,
            client_shutdown_sent: false,
        }
    }

    /// Drive one iteration of bidirectional I/O.  Returns `true` to keep the
    /// connection alive, `false` when it should be torn down.
    fn pump(&mut self) -> bool {
        let mut buf = [0u8; 16 * 1024];

        // ── client → SSH channel ─────────────────────────────────────────────

        // 1. Read fresh bytes from the TCP client into the pending buffer.
        if !self.client_read_eof {
            loop {
                match self.client.read(&mut buf) {
                    Ok(0) => {
                        self.client_read_eof = true;
                        break;
                    }
                    Ok(n) => self.to_channel.extend_from_slice(&buf[..n]),
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break,
                    Err(_) => return false,
                }
            }
        }

        // 2. Write the pending buffer to the SSH channel.
        if !self.to_channel.is_empty() {
            match self.channel.write(&self.to_channel) {
                Ok(0) => {} // SSH window full; retry next iteration
                Ok(n) => {
                    self.to_channel.drain(..n);
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {} // EAGAIN
                Err(_) => return false,
            }
        }

        // 3. Once the client is done and the buffer is drained, signal EOF.
        if self.client_read_eof && self.to_channel.is_empty() && !self.channel_eof_sent {
            let _ = self.channel.send_eof();
            self.channel_eof_sent = true;
        }

        // ── SSH channel → client ─────────────────────────────────────────────

        // 4. Read fresh bytes from the SSH channel into the pending buffer.
        if !self.channel_read_eof {
            loop {
                match self.channel.read(&mut buf) {
                    Ok(0) => {
                        self.channel_read_eof = true;
                        break;
                    }
                    Ok(n) => self.to_client.extend_from_slice(&buf[..n]),
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => break, // EAGAIN
                    Err(_) => return false,
                }
            }
        }

        // 5. Write the pending buffer to the TCP client.
        if !self.to_client.is_empty() {
            match self.client.write(&self.to_client) {
                Ok(0) => {} // TCP send buffer full; retry next iteration
                Ok(n) => {
                    self.to_client.drain(..n);
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(_) => return false,
            }
        }

        // 6. Once the channel is done and the buffer is drained, close our
        //    write side toward the client.
        if self.channel_read_eof && self.to_client.is_empty() && !self.client_shutdown_sent {
            let _ = self.client.shutdown(Shutdown::Write);
            self.client_shutdown_sent = true;
        }

        // ── done? ────────────────────────────────────────────────────────────
        let client_side_done = self.client_read_eof && self.to_channel.is_empty();
        let channel_side_done = self.channel_read_eof && self.to_client.is_empty();

        if client_side_done && channel_side_done {
            let _ = self.channel.close();
            return false;
        }

        true
    }
}

// ── public entrypoint ─────────────────────────────────────────────────────────

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

    // ── blocking setup phase ──────────────────────────────────────────────────

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

    // Verify that the SSH server can reach the database target before handing
    // the tunnel to the caller.  This is done in blocking mode before we switch
    // to the non-blocking event loop.  We open and immediately close a channel
    // so we don't send any protocol data to the database listener.
    verify_remote_reachable(&session, &db_host, db_port)?;

    // Switch to non-blocking for the event loop.  All session operations from
    // here on (keepalive, channel opens, channel I/O) run in a single thread,
    // so there is no mutex contention between concurrent channel operations.
    session.set_timeout(0);
    session.set_keepalive(true, SSH_KEEPALIVE_INTERVAL_SECS);
    session.set_blocking(false);

    // ── local listener ────────────────────────────────────────────────────────

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

    // ── event loop ────────────────────────────────────────────────────────────

    let join_handle = thread::spawn(move || {
        // Connections waiting for channel_direct_tcpip to complete (EAGAIN retry).
        let mut pending: Vec<PendingConn> = Vec::new();
        // Active proxied connections.
        let mut connections: Vec<ProxyConn> = Vec::new();
        let mut last_keepalive = Instant::now();

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // ── keepalive ─────────────────────────────────────────────────────
            // keepalive_send() in non-blocking mode may return EAGAIN; we just
            // try again on the next iteration when it's due.
            if last_keepalive.elapsed().as_secs() >= SSH_KEEPALIVE_INTERVAL_SECS as u64 {
                match session.keepalive_send() {
                    Ok(_) => {
                        last_keepalive = Instant::now();
                    }
                    Err(ref e) if e.code() == SSH_EAGAIN => {}
                    Err(error) => {
                        eprintln!("SSH keepalive failed: {error}");
                        last_keepalive = Instant::now();
                    }
                }
            }

            // ── accept new TCP connections ────────────────────────────────────
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nodelay(true);
                    let _ = stream.set_nonblocking(true);
                    pending.push(PendingConn { stream, retries: 0 });
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => {
                    eprintln!("SSH tunnel listener error: {error}");
                }
            }

            // ── open SSH channels for pending connections ─────────────────────
            // channel_direct_tcpip may return EAGAIN in non-blocking mode; we
            // retry up to CHANNEL_OPEN_MAX_RETRIES times before giving up.
            let mut still_pending: Vec<PendingConn> = Vec::new();
            for mut p in pending.drain(..) {
                match session.channel_direct_tcpip(&db_host, db_port, None) {
                    Ok(channel) => {
                        connections.push(ProxyConn::new(p.stream, channel));
                    }
                    Err(ref e) if e.code() == SSH_EAGAIN => {
                        p.retries += 1;
                        if p.retries < CHANNEL_OPEN_MAX_RETRIES {
                            still_pending.push(p);
                        } else {
                            eprintln!(
                                "SSH channel open timed out for {}:{}",
                                db_host, db_port
                            );
                            // p.stream dropped → RST sent to client
                        }
                    }
                    Err(error) => {
                        eprintln!(
                            "SSH direct-tcpip open failed for {}:{}: {}",
                            db_host, db_port, error
                        );
                        // p.stream dropped → RST sent to client
                    }
                }
            }
            pending = still_pending;

            // ── drive active proxy connections ────────────────────────────────
            let mut had_activity = !connections.is_empty() || !pending.is_empty();
            connections.retain_mut(|conn| conn.pump());

            // Sleep only when there is nothing to do, to avoid busy-spinning
            // while still being responsive when data arrives.
            if !had_activity {
                had_activity = !connections.is_empty();
            }
            if !had_activity {
                thread::sleep(Duration::from_millis(1));
            }
        }
    });

    Ok(SshTunnelHandle {
        local_port,
        stop_tx,
        join_handle: Some(join_handle),
    })
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

/// Opens a direct-tcpip channel to the database host/port and immediately
/// closes it, to verify the SSH server can reach the target before the caller
/// starts accepting connections.  Uses blocking mode (must be called before
/// switching the session to non-blocking).
fn verify_remote_reachable(session: &Session, db_host: &str, db_port: u16) -> Result<(), String> {
    let mut channel = session
        .channel_direct_tcpip(db_host, db_port, None)
        .map_err(|error| {
            format!("SSH tunnel could not reach database target {db_host}:{db_port}: {error}")
        })?;
    let _ = channel.close();
    let _ = channel.wait_close();
    Ok(())
}
