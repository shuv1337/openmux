export function createExitHandlers(params: {
  saveSession: () => Promise<void>;
  shutdownShim: () => Promise<void>;
  disposeRuntime: () => Promise<void>;
  renderer: { destroy: () => void };
}) {
  const { saveSession, shutdownShim, disposeRuntime, renderer } = params;
  let detaching = false;

  const handleQuit = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    await shutdownShim();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  const handleDetach = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  const handleShimDetached = () => {
    if (detaching) return;
    detaching = true;
    renderer.destroy();
    process.exit(0);
  };

  return {
    handleQuit,
    handleDetach,
    handleShimDetached,
  };
}
