//! Test module aggregator for zig-git.
//!
//! Each file focuses on a specific surface area to keep tests modular.

comptime {
    _ = @import("repo_info_tests.zig");
    _ = @import("repo_status_tests.zig");
    _ = @import("status_async_tests.zig");
    _ = @import("diff_stats_tests.zig");
}
