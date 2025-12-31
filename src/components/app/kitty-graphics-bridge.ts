import { onCleanup, onMount } from 'solid-js';
import { deferNextTick } from '../../core/scheduling';
import { KittyGraphicsRenderer, setKittyGraphicsRenderer } from '../../terminal/kitty-graphics';
import { getHostCapabilities } from '../../terminal/capabilities';

type RendererLike = {
  renderNative?: () => void;
  prependInputHandler?: (handler: (sequence: string) => boolean) => void;
  removeInputHandler?: (handler: (sequence: string) => boolean) => void;
};

export function createKittyGraphicsBridge(params: {
  renderer: RendererLike;
  ensurePixelResize: () => void;
  stopPixelResizePoll: () => void;
}): KittyGraphicsRenderer {
  const { renderer, ensurePixelResize, stopPixelResizePoll } = params;
  const kittyRenderer = new KittyGraphicsRenderer();
  setKittyGraphicsRenderer(kittyRenderer);

  onMount(() => {
    const rendererAny = renderer as any;
    const originalRenderNative = rendererAny.renderNative?.bind(rendererAny);
    const pixelResolutionRegex = /\x1b\[4;\d+;\d+t/;
    const kittyResponseStartRegex = /(?:\x1b_G|\x9fG)/;
    const kittyResponseEndRegex = /(?:\x1b\\|\x9c)/;
    let kittyResponseBuffer = '';

    const handlePixelResolution = (sequence: string) => {
      if (!pixelResolutionRegex.test(sequence)) return false;
      deferNextTick(() => {
        ensurePixelResize();
      });
      return false;
    };

    const handleKittyResponses = (sequence: string) => {
      if (kittyResponseBuffer.length > 0) {
        kittyResponseBuffer += sequence;
        if (kittyResponseEndRegex.test(kittyResponseBuffer)) {
          kittyResponseBuffer = '';
        } else if (kittyResponseBuffer.length > 4096) {
          kittyResponseBuffer = '';
        }
        return true;
      }

      if (!kittyResponseStartRegex.test(sequence)) return false;
      if (!kittyResponseEndRegex.test(sequence)) {
        kittyResponseBuffer = sequence;
      }
      return true;
    };

    const hostCaps = getHostCapabilities();
    // Avoid render-thread output interleaving with kitty APC writes on shared stdout.
    const shouldDisableThread = !!hostCaps?.kittyGraphics && typeof rendererAny.useThread !== 'undefined';
    const previousUseThread = shouldDisableThread ? rendererAny.useThread : undefined;
    if (shouldDisableThread && rendererAny.useThread !== false) {
      rendererAny.useThread = false;
    }

    if (originalRenderNative) {
      rendererAny.renderNative = () => {
        originalRenderNative();
        kittyRenderer.flush(rendererAny);
      };
    }

    rendererAny.prependInputHandler?.(handleKittyResponses);
    rendererAny.prependInputHandler?.(handlePixelResolution);
    ensurePixelResize();

    onCleanup(() => {
      if (originalRenderNative) {
        rendererAny.renderNative = originalRenderNative;
      }
      if (shouldDisableThread && typeof previousUseThread === 'boolean') {
        rendererAny.useThread = previousUseThread;
      }
      rendererAny.removeInputHandler?.(handleKittyResponses);
      rendererAny.removeInputHandler?.(handlePixelResolution);
      stopPixelResizePoll();
      kittyRenderer.dispose();
      setKittyGraphicsRenderer(null);
      kittyResponseBuffer = '';
    });
  });

  return kittyRenderer;
}
