//! Handle Registry for PTY management

const std = @import("std");
const Pty = @import("pty.zig").Pty;
const constants = @import("constants.zig");

var handles: [constants.MAX_HANDLES]?Pty = [_]?Pty{null} ** constants.MAX_HANDLES;
var next_handle: u32 = 1;
var registry_mutex: std.Thread.Mutex = .{};

pub fn allocHandle() ?u32 {
    registry_mutex.lock();
    defer registry_mutex.unlock();

    // Find free slot
    var i: u32 = 0;
    while (i < constants.MAX_HANDLES) : (i += 1) {
        const idx: u32 = @intCast((next_handle + i) % constants.MAX_HANDLES);
        if (idx == 0) continue; // Reserve 0 as invalid
        if (handles[idx] == null) {
            next_handle = idx + 1;
            return idx;
        }
    }
    return null;
}

pub fn getHandle(h: u32) ?*Pty {
    if (h == 0 or h >= constants.MAX_HANDLES) return null;
    registry_mutex.lock();
    defer registry_mutex.unlock();
    if (handles[h]) |*pty| {
        return pty;
    }
    return null;
}

pub fn setHandle(h: u32, pty: Pty) void {
    registry_mutex.lock();
    defer registry_mutex.unlock();
    handles[h] = pty;
}

pub fn removeHandle(h: u32) void {
    if (h == 0 or h >= constants.MAX_HANDLES) return;
    registry_mutex.lock();
    defer registry_mutex.unlock();
    if (handles[h]) |*pty| {
        pty.deinit();
        handles[h] = null;
    }
}
