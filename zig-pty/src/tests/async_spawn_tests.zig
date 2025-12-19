//! Async Spawn Tests
//! Tests for asynchronous PTY spawning functionality.

const std = @import("std");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");

// ============================================================================
// Async Spawn Flow Tests
// ============================================================================

test "async spawn basic flow" {
    const request_id = exports.bun_pty_spawn_async("echo async", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Poll until complete
    var handle: c_int = constants.SPAWN_PENDING;
    var iterations: usize = 0;
    while (handle == constants.SPAWN_PENDING and iterations < 100) : (iterations += 1) {
        handle = exports.bun_pty_spawn_poll(request_id);
        if (handle == constants.SPAWN_PENDING) {
            std.Thread.sleep(10 * std.time.ns_per_ms);
        }
    }

    try std.testing.expect(handle > 0);
    exports.bun_pty_close(handle);
}

test "async spawn with cwd" {
    const request_id = exports.bun_pty_spawn_async("pwd", "/tmp", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    var handle: c_int = constants.SPAWN_PENDING;
    var iterations: usize = 0;
    while (handle == constants.SPAWN_PENDING and iterations < 100) : (iterations += 1) {
        handle = exports.bun_pty_spawn_poll(request_id);
        if (handle == constants.SPAWN_PENDING) {
            std.Thread.sleep(10 * std.time.ns_per_ms);
        }
    }

    try std.testing.expect(handle > 0);

    // Wait for output and verify
    std.Thread.sleep(100 * std.time.ns_per_ms);
    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    if (n > 0) {
        const output = buf[0..@intCast(n)];
        try std.testing.expect(std.mem.indexOf(u8, output, "tmp") != null);
    }

    exports.bun_pty_close(handle);
}

// ============================================================================
// Async Spawn Cancel Tests
// ============================================================================

test "async spawn cancel before completion" {
    // Start async spawn
    const request_id = exports.bun_pty_spawn_async("sleep 10", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Cancel immediately (may or may not have completed)
    exports.bun_pty_spawn_cancel(request_id);

    // Polling after cancel should return error
    const result = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, result);
}

test "async spawn cancel after completion" {
    const request_id = exports.bun_pty_spawn_async("echo done", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Wait for completion
    var iterations: usize = 0;
    while (iterations < 100) : (iterations += 1) {
        const result = exports.bun_pty_spawn_poll(request_id);
        if (result != constants.SPAWN_PENDING) break;
        std.Thread.sleep(10 * std.time.ns_per_ms);
    }

    // Now cancel - should clean up the handle
    exports.bun_pty_spawn_cancel(request_id);

    // Polling again should return error (already freed)
    const result = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, result);
}

// ============================================================================
// Async Spawn Invalid Input Tests
// ============================================================================

test "async spawn invalid dimensions returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 0, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, 0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", -1, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, -1));
}

test "async spawn poll invalid request returns error" {
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(-1));
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(99999));
}

// ============================================================================
// Multiple Concurrent Async Spawns
// ============================================================================

test "multiple concurrent async spawns" {
    var request_ids: [4]c_int = undefined;
    var handles: [4]c_int = undefined;

    // Start multiple async spawns
    for (&request_ids, 0..) |*rid, i| {
        rid.* = exports.bun_pty_spawn_async("echo test", "", "", 80, 24);
        try std.testing.expect(rid.* >= 0);
        _ = i;
    }

    // Wait for all to complete
    for (&handles, 0..) |*h, i| {
        var iterations: usize = 0;
        h.* = constants.SPAWN_PENDING;
        while (h.* == constants.SPAWN_PENDING and iterations < 100) : (iterations += 1) {
            h.* = exports.bun_pty_spawn_poll(request_ids[i]);
            if (h.* == constants.SPAWN_PENDING) {
                std.Thread.sleep(10 * std.time.ns_per_ms);
            }
        }
        try std.testing.expect(h.* > 0);
    }

    // Close all
    for (handles) |h| {
        exports.bun_pty_close(h);
    }
}
