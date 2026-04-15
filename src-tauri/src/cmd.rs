use std::ffi::OsStr;
use std::process::Command;

/// Creates a `Command` that runs in the background with no visible console window.
/// On Windows this sets the `CREATE_NO_WINDOW` creation flag (0x08000000).
/// On other platforms it behaves identically to `Command::new`.
pub fn background<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
