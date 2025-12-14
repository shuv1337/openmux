//! zig-pty: Pure Zig PTY implementation for Bun FFI
//!
//! A minimal, high-performance pseudoterminal library.
//! Uses direct POSIX calls - no external dependencies.

const std = @import("std");
const builtin = @import("builtin");
const c = @cImport({
    @cInclude("stdlib.h");
    @cInclude("unistd.h");
    @cInclude("fcntl.h");
    @cInclude("errno.h");
    @cInclude("string.h");
    @cInclude("signal.h");
    @cInclude("sys/wait.h");
    @cInclude("sys/ioctl.h");
    if (builtin.os.tag == .macos) {
        @cInclude("util.h");
        @cInclude("crt_externs.h");
    } else {
        @cInclude("pty.h");
    }
    @cInclude("termios.h");
});

// Get environ - platform specific
fn getEnviron() ?[*:null]?[*:0]u8 {
    if (builtin.os.tag == .macos) {
        const environ_ptr = c._NSGetEnviron();
        if (environ_ptr) |ptr| {
            return @ptrCast(ptr.*);
        }
        return null;
    } else {
        // Linux - use std.c.environ
        return @ptrCast(std.c.environ);
    }
}

// ============================================================================
// Constants
// ============================================================================

const SUCCESS: c_int = 0;
const ERROR: c_int = -1;
const CHILD_EXITED: c_int = -2;

const MAX_HANDLES: usize = 256;

// ============================================================================
// PTY Handle
// ============================================================================

const Pty = struct {
    master_fd: c_int,
    pid: c_int,
    exited: bool,
    exit_code: c_int,

    fn init(master_fd: c_int, pid: c_int) Pty {
        return .{
            .master_fd = master_fd,
            .pid = pid,
            .exited = false,
            .exit_code = -1,
        };
    }

    fn deinit(self: *Pty) void {
        if (self.master_fd >= 0) {
            _ = c.close(self.master_fd);
            self.master_fd = -1;
        }
    }

    fn checkChild(self: *Pty) void {
        if (self.exited) return;

        var status: c_int = 0;
        const result = c.waitpid(self.pid, &status, c.WNOHANG);

        if (result == self.pid) {
            self.exited = true;
            if (c.WIFEXITED(status)) {
                self.exit_code = c.WEXITSTATUS(status);
            } else if (c.WIFSIGNALED(status)) {
                self.exit_code = 128 + c.WTERMSIG(status);
            }
        } else if (result == -1) {
            // Process doesn't exist anymore
            self.exited = true;
            self.exit_code = -1;
        }
    }

    fn readAvailable(self: *Pty, buf: [*]u8, len: usize) c_int {
        self.checkChild();

        if (self.exited and self.master_fd < 0) {
            return CHILD_EXITED;
        }

        // Drain all available data
        var total: usize = 0;

        while (total < len) {
            const remaining = len - total;
            const n = c.read(self.master_fd, buf + total, remaining);

            if (n > 0) {
                total += @intCast(n);
                // Continue draining
            } else if (n == 0) {
                // EOF
                break;
            } else {
                // n < 0, check errno
                const err = std.c._errno().*;
                if (err == c.EAGAIN or err == c.EWOULDBLOCK) {
                    // No more data available
                    break;
                } else if (err == c.EINTR) {
                    continue;
                } else {
                    // Real error
                    if (total > 0) break;
                    return ERROR;
                }
            }
        }

        if (total > 0) {
            return @intCast(total);
        } else if (self.exited) {
            return CHILD_EXITED;
        } else {
            return 0;
        }
    }

    fn write(self: *Pty, data: [*]const u8, len: usize) c_int {
        self.checkChild();

        if (self.exited) {
            return CHILD_EXITED;
        }

        var written: usize = 0;
        while (written < len) {
            const n = c.write(self.master_fd, data + written, len - written);
            if (n > 0) {
                written += @intCast(n);
            } else if (n == -1) {
                const err = std.c._errno().*;
                if (err == c.EINTR) {
                    continue;
                } else {
                    return ERROR;
                }
            } else {
                break;
            }
        }

        return if (written == len) SUCCESS else ERROR;
    }

    fn resize(self: *Pty, cols: u16, rows: u16) c_int {
        var ws: c.winsize = .{
            .ws_col = cols,
            .ws_row = rows,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };

        if (c.ioctl(self.master_fd, c.TIOCSWINSZ, &ws) == -1) {
            return ERROR;
        }

        return SUCCESS;
    }

    fn kill(self: *Pty) c_int {
        if (self.pid > 0) {
            _ = c.kill(self.pid, c.SIGTERM);
        }
        return SUCCESS;
    }
};

// ============================================================================
// Handle Registry
// ============================================================================

var handles: [MAX_HANDLES]?Pty = [_]?Pty{null} ** MAX_HANDLES;
var next_handle: u32 = 1;
var registry_mutex: std.Thread.Mutex = .{};

fn allocHandle() ?u32 {
    registry_mutex.lock();
    defer registry_mutex.unlock();

    // Find free slot
    var i: u32 = 0;
    while (i < MAX_HANDLES) : (i += 1) {
        const idx: u32 = @intCast((next_handle + i) % MAX_HANDLES);
        if (idx == 0) continue; // Reserve 0 as invalid
        if (handles[idx] == null) {
            next_handle = idx + 1;
            return idx;
        }
    }
    return null;
}

fn getHandle(h: u32) ?*Pty {
    if (h == 0 or h >= MAX_HANDLES) return null;
    registry_mutex.lock();
    defer registry_mutex.unlock();
    if (handles[h]) |*pty| {
        return pty;
    }
    return null;
}

fn setHandle(h: u32, pty: Pty) void {
    registry_mutex.lock();
    defer registry_mutex.unlock();
    handles[h] = pty;
}

fn removeHandle(h: u32) void {
    if (h == 0 or h >= MAX_HANDLES) return;
    registry_mutex.lock();
    defer registry_mutex.unlock();
    if (handles[h]) |*pty| {
        pty.deinit();
        handles[h] = null;
    }
}

// ============================================================================
// PTY Creation
// ============================================================================

fn setNonBlocking(fd: c_int) bool {
    const flags = c.fcntl(fd, c.F_GETFL);
    if (flags == -1) return false;
    return c.fcntl(fd, c.F_SETFL, flags | c.O_NONBLOCK) != -1;
}

fn setCloseOnExec(fd: c_int) void {
    _ = c.fcntl(fd, c.F_SETFD, c.FD_CLOEXEC);
}

fn spawnPty(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env_str: [*:0]const u8,
    cols: u16,
    rows: u16,
) c_int {
    var master_fd: c_int = undefined;
    var slave_fd: c_int = undefined;

    // Set up window size
    var ws: c.winsize = .{
        .ws_col = cols,
        .ws_row = rows,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    // Open PTY pair
    if (c.openpty(&master_fd, &slave_fd, null, null, &ws) == -1) {
        return ERROR;
    }

    // Set master to non-blocking
    if (!setNonBlocking(master_fd)) {
        _ = c.close(master_fd);
        _ = c.close(slave_fd);
        return ERROR;
    }

    setCloseOnExec(master_fd);

    // Fork
    const pid = c.fork();

    if (pid == -1) {
        // Fork failed
        _ = c.close(master_fd);
        _ = c.close(slave_fd);
        return ERROR;
    }

    if (pid == 0) {
        // Child process
        _ = c.close(master_fd);

        // Create new session
        _ = c.setsid();

        // Set controlling terminal
        _ = c.ioctl(slave_fd, c.TIOCSCTTY, @as(c_int, 0));

        // Dup slave to stdin/stdout/stderr
        _ = c.dup2(slave_fd, 0);
        _ = c.dup2(slave_fd, 1);
        _ = c.dup2(slave_fd, 2);

        if (slave_fd > 2) {
            _ = c.close(slave_fd);
        }

        // Change directory if specified
        if (cwd[0] != 0) {
            _ = c.chdir(cwd);
        }

        // Parse environment variables
        var env_ptrs: [256]?[*:0]const u8 = [_]?[*:0]const u8{null} ** 256;
        var env_count: usize = 0;

        // Copy current environment first
        if (getEnviron()) |environ| {
            var i: usize = 0;
            while (environ[i] != null and env_count < 250) : (i += 1) {
                env_ptrs[env_count] = @ptrCast(environ[i].?);
                env_count += 1;
            }
        }

        // Parse additional env vars from null-separated string
        if (env_str[0] != 0) {
            var ptr: [*:0]const u8 = env_str;
            while (ptr[0] != 0 and env_count < 255) {
                env_ptrs[env_count] = ptr;
                env_count += 1;
                // Skip to next null
                while (ptr[0] != 0) ptr += 1;
                ptr += 1;
            }
        }
        env_ptrs[env_count] = null;

        // Parse command line - simple shell-based approach
        // We'll let the shell handle the parsing
        const shell_env = c.getenv("SHELL");
        const shell: [*:0]const u8 = if (shell_env != null)
            @ptrCast(shell_env)
        else
            "/bin/sh";

        const argv = [_:null]?[*:0]const u8{
            shell,
            "-c",
            cmd,
            null,
        };

        _ = c.execve(
            shell,
            @ptrCast(&argv),
            @ptrCast(&env_ptrs),
        );

        // If execve fails, exit
        c._exit(127);
    }

    // Parent process
    _ = c.close(slave_fd);

    // Allocate handle
    const h = allocHandle() orelse {
        _ = c.close(master_fd);
        _ = c.kill(pid, c.SIGKILL);
        return ERROR;
    };

    setHandle(h, Pty.init(master_fd, pid));
    return @intCast(h);
}

// ============================================================================
// FFI Exports
// ============================================================================

export fn bun_pty_spawn(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    if (cols <= 0 or rows <= 0) {
        return ERROR;
    }
    return spawnPty(cmd, cwd, env, @intCast(cols), @intCast(rows));
}

export fn bun_pty_read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    return pty.readAvailable(buf, @intCast(len));
}

export fn bun_pty_write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    return pty.write(data, @intCast(len));
}

export fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    if (handle <= 0 or cols <= 0 or rows <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    return pty.resize(@intCast(cols), @intCast(rows));
}

export fn bun_pty_kill(handle: c_int) c_int {
    if (handle <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    return pty.kill();
}

export fn bun_pty_get_pid(handle: c_int) c_int {
    if (handle <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    return pty.pid;
}

export fn bun_pty_get_exit_code(handle: c_int) c_int {
    if (handle <= 0) {
        return ERROR;
    }

    const pty = getHandle(@intCast(handle)) orelse return ERROR;
    pty.checkChild();
    return pty.exit_code;
}

export fn bun_pty_close(handle: c_int) void {
    if (handle <= 0) {
        return;
    }
    removeHandle(@intCast(handle));
}

// ============================================================================
// Tests
// ============================================================================

test "basic pty spawn" {
    const handle = bun_pty_spawn("echo hello", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Wait a bit for output
    std.time.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n >= 0);

    bun_pty_close(handle);
}
