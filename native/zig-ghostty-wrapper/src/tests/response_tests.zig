const std = @import("std");
const terminal = @import("../terminal.zig");

const testing = std.testing;

test "smoke: device status response buffer" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    terminal.write(term, "\x1b[6n", 4);
    try testing.expect(terminal.hasResponse(term));

    var buf: [32]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expect(written > 0);
    try testing.expectEqualStrings("\x1b[1;1R", buf[0..@intCast(written)]);
}
