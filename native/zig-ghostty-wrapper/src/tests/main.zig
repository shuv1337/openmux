//! Test module aggregator for zig-ghostty-wrapper.
//!
//! Each file focuses on a specific surface area to keep tests modular.

comptime {
    _ = @import("terminal_tests.zig");
    _ = @import("kitty_tests.zig");
    _ = @import("response_tests.zig");
    _ = @import("scrollback_tests.zig");
}
