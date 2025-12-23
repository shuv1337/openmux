import { startShimServer } from './server';

export async function runShim(): Promise<void> {
  const server = await startShimServer();

  const cleanup = () => {
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

if (import.meta.main) {
  runShim().catch((error) => {
    console.error('Failed to start shim:', error);
    process.exit(1);
  });
}
