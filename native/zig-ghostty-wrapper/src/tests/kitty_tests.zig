const std = @import("std");
const terminal = @import("../terminal.zig");

const testing = std.testing;

test "litmus: kitty graphics plumbing is available" {
    const term = terminal.new(1, 1);
    defer terminal.free(term);

    try testing.expectEqual(@as(c_int, 0), terminal.getKittyImageCount(term));
    try testing.expect(!terminal.getKittyImagesDirty(term));
}

test "litmus: kitty query accepts non-direct medium" {
    const term = terminal.new(2, 2);
    defer terminal.free(term);

    const query = "\x1b_Ga=q,t=f,i=1;\x1b\\";
    terminal.write(term, query, query.len);

    try testing.expect(terminal.hasResponse(term));

    var buf: [64]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expectEqualStrings("\x1b_Gi=1;OK\x1b\\", buf[0..@intCast(written)]);
}

test "litmus: kitty passthrough accepts empty payloads" {
    const term = terminal.new(4, 4);
    defer terminal.free(term);

    const sequence = "\x1b_Ga=T,f=100,s=2,v=3,i=7;\x1b\\";
    terminal.write(term, sequence, sequence.len);

    try testing.expectEqual(@as(c_int, 1), terminal.getKittyImageCount(term));
    try testing.expectEqual(@as(c_int, 1), terminal.getKittyPlacementCount(term));

    var info: terminal.GhosttyKittyImageInfo = undefined;
    try testing.expect(terminal.getKittyImageInfo(term, 7, &info));
    try testing.expectEqual(@as(u32, 2), info.width);
    try testing.expectEqual(@as(u32, 3), info.height);
    try testing.expectEqual(@as(u32, 0), info.data_len);

    try testing.expect(terminal.hasResponse(term));
    var buf: [64]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expectEqualStrings("\x1b_Gi=7;OK\x1b\\", buf[0..@intCast(written)]);
}
