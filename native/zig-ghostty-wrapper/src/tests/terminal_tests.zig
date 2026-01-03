const std = @import("std");
const terminal = @import("../terminal.zig");

const testing = std.testing;

test "terminal lifecycle" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);
    try testing.expect(term != null);

    _ = terminal.renderStateUpdate(term);
    try testing.expectEqual(@as(c_int, 80), terminal.renderStateGetCols(term));
    try testing.expectEqual(@as(c_int, 24), terminal.renderStateGetRows(term));
}

test "terminal write and read via render state" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    terminal.write(term, "Hello", 5);
    _ = terminal.renderStateUpdate(term);

    var cells: [80 * 24]terminal.GhosttyCell = undefined;
    const count = terminal.renderStateGetViewport(term, &cells, 80 * 24);
    try testing.expectEqual(@as(c_int, 80 * 24), count);
    try testing.expectEqual(@as(u32, 'H'), cells[0].codepoint);
    try testing.expectEqual(@as(u32, 'e'), cells[1].codepoint);
    try testing.expectEqual(@as(u32, 'l'), cells[2].codepoint);
    try testing.expectEqual(@as(u32, 'l'), cells[3].codepoint);
    try testing.expectEqual(@as(u32, 'o'), cells[4].codepoint);
}
