/**
 * Interactive terminal preview component for aggregate view
 * Thin wrapper around TerminalView that handles PTY resize
 */

import { Show, createEffect, on } from 'solid-js';
import { resizePty } from '../../effect/bridge';
import { TerminalView } from '../TerminalView';

interface InteractivePreviewProps {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}

export function InteractivePreview(props: InteractivePreviewProps) {
  // Track last resize to avoid redundant calls
  let lastResize: { ptyId: string; width: number; height: number } | null = null;

  // Resize PTY when previewing to match preview dimensions
  // When aggregate view closes, App.tsx will restore the original pane dimensions
  createEffect(
    on(
      [() => props.ptyId, () => props.width, () => props.height],
      ([ptyId, width, height]) => {
        if (!ptyId) return;

        // Only resize if dimensions actually changed
        if (lastResize && lastResize.ptyId === ptyId && lastResize.width === width && lastResize.height === height) {
          return;
        }

        resizePty(ptyId, width, height);
        lastResize = { ptyId, width, height };
      },
      { defer: false }
    )
  );

  return (
    <Show
      when={props.ptyId}
      fallback={
        <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
          <text fg="#666666">No terminal selected</text>
        </box>
      }
    >
      <TerminalView
        ptyId={props.ptyId!}
        width={props.width}
        height={props.height}
        isFocused={props.isInteractive}
        offsetX={props.offsetX}
        offsetY={props.offsetY}
      />
    </Show>
  );
}
