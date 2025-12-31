type RendererLike = {
  resolution?: { width: number; height: number } | null;
  terminalWidth?: number;
  terminalHeight?: number;
  width?: number;
  height?: number;
};

export type CellMetrics = { cellWidth: number; cellHeight: number };

export function createCellMetricsGetter(
  renderer: RendererLike,
  width: () => number,
  height: () => number
): () => CellMetrics | null {
  return () => {
    const rendererAny = renderer as RendererLike;
    const resolution = rendererAny?.resolution ?? null;
    const terminalWidth = width() || rendererAny?.terminalWidth || rendererAny?.width || 0;
    const terminalHeight = height() || rendererAny?.terminalHeight || rendererAny?.height || 0;
    if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;
    return {
      cellWidth: Math.max(1, Math.floor(resolution.width / terminalWidth)),
      cellHeight: Math.max(1, Math.floor(resolution.height / terminalHeight)),
    };
  };
}

export function createPixelResizeTracker(params: {
  getCellMetrics: () => CellMetrics | null;
  isTerminalInitialized: () => boolean;
  getPaneCount: () => number;
  scheduleResizeAllPanes: () => void;
}) {
  const { getCellMetrics, isTerminalInitialized, getPaneCount, scheduleResizeAllPanes } = params;

  let pixelResizeInterval: ReturnType<typeof setInterval> | null = null;

  const stopPixelResizePoll = () => {
    if (pixelResizeInterval) {
      clearInterval(pixelResizeInterval);
      pixelResizeInterval = null;
    }
  };

  const ensurePixelResize = () => {
    const metrics = getCellMetrics();
    const hasPanes = getPaneCount() > 0;
    if (isTerminalInitialized() && metrics && hasPanes) {
      scheduleResizeAllPanes();
      stopPixelResizePoll();
      return;
    }

    if (!pixelResizeInterval) {
      let attempts = 0;
      const maxAttempts = 40; // ~2s at 50ms
      pixelResizeInterval = setInterval(() => {
        attempts += 1;
        const ready = isTerminalInitialized() && getCellMetrics() && getPaneCount() > 0;
        if (ready || attempts >= maxAttempts) {
          if (ready) {
            scheduleResizeAllPanes();
          }
          stopPixelResizePoll();
        }
      }, 50);
    }
  };

  return {
    ensurePixelResize,
    stopPixelResizePoll,
  };
}
