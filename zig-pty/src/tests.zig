//! Tests for zig-pty

const std = @import("std");
const spawn_module = @import("spawn.zig");
const exports = @import("exports.zig");

test "basic pty spawn" {
    const handle = spawn_module.spawnPty("echo hello", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Wait a bit for output
    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n >= 0);

    exports.bun_pty_close(handle);
}

test "pty spawn with cwd" {
    const handle = spawn_module.spawnPty("pwd", "/tmp", "", 80, 24);
    try std.testing.expect(handle > 0);

    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n > 0);

    // Output should contain /tmp
    const output = buf[0..@intCast(n)];
    try std.testing.expect(std.mem.indexOf(u8, output, "/tmp") != null);

    exports.bun_pty_close(handle);
}

test "pty resize" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    const constants = @import("constants.zig");
    const result = exports.bun_pty_resize(handle, 120, 40);
    try std.testing.expectEqual(constants.SUCCESS, result);

    exports.bun_pty_close(handle);
}
