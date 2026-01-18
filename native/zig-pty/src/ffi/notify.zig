//! macOS notify(3) helpers for appearance change listeners.

const builtin = @import("builtin");
const constants = @import("../util/constants.zig");
const posix = @import("../util/posix.zig");
const c = posix.c;

/// Register for a Darwin notify(3) name and return a file descriptor.
/// The fd becomes readable when the notification is posted.
/// Returns: fd (>= 0) on success, or ERROR (-1) on failure.
pub fn notifyRegister(name: [*:0]const u8, out_token: *c_int) c_int {
    if (builtin.os.tag != .macos) return constants.ERROR;

    var fd: c_int = -1;
    var token: c_int = -1;
    const status = c.notify_register_file_descriptor(name, &fd, 0, &token);
    if (status != 0 or fd < 0) return constants.ERROR;

    out_token.* = token;
    return fd;
}

/// Cancel a previously registered notification token.
pub fn notifyCancel(token: c_int) c_int {
    if (builtin.os.tag != .macos) return constants.ERROR;
    if (token < 0) return constants.ERROR;
    const status = c.notify_cancel(token);
    if (status != 0) return constants.ERROR;
    return constants.SUCCESS;
}

/// Register for a Darwin notify(3) name and deliver as a signal.
/// Returns: token (>= 0) on success, or ERROR (-1) on failure.
pub fn notifyRegisterSignal(name: [*:0]const u8, sig: c_int) c_int {
    if (builtin.os.tag != .macos) return constants.ERROR;
    if (sig <= 0) return constants.ERROR;

    var token: c_int = -1;
    const status = c.notify_register_signal(name, sig, &token);
    if (status != 0 or token < 0) return constants.ERROR;
    return token;
}
