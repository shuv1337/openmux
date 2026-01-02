const DEFAULT_OFFLOAD_THRESHOLD = 512 * 1024;
const DEFAULT_OFFLOAD_CLEANUP_MS = 5000;

export function isSshSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

export function resolveKittyOffloadThreshold(): number {
  const raw = process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return isSshSession() ? 0 : DEFAULT_OFFLOAD_THRESHOLD;
}

export function resolveKittyOffloadCleanupDelay(): number {
  const raw = process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_OFFLOAD_CLEANUP_MS;
}
