export function isShimProcess(): boolean {
  return process.argv.includes('--shim');
}

export function isShimClient(): boolean {
  return !isShimProcess();
}
