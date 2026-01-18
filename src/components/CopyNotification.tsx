/**
 * CopyNotification - displays a toast when text is copied to clipboard
 * Positioned at the top-right of the pane where copy occurred
 */

import { Show, type Accessor } from 'solid-js';
import { RGBA } from '@opentui/core';
import { useTheme } from '../contexts/ThemeContext';

interface PaneRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopyNotificationProps {
  visible: boolean;
  charCount: number;
  /** Rectangle of the pane where copy occurred */
  paneRect: PaneRectangle | null;
}

const TOAST_WIDTH = 25;
const TOAST_HEIGHT = 3;

// Dark gray background with 80% opacity
const DEFAULT_BG_COLOR = RGBA.fromInts(34, 36, 46, 204);
const HEX_RGBA_RE = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

function parseRgbaHex(value: string, fallback: RGBA): RGBA {
  const match = HEX_RGBA_RE.exec(value);
  if (!match) return fallback;
  const hex = match[1];
  const alpha = match[2];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = alpha ? parseInt(alpha, 16) : 255;
  return RGBA.fromInts(r, g, b, a);
}

/**
 * A toast notification that appears at the top-right of the pane
 * Styled with left/right partial borders matching the pane focus color
 * Uses semi-transparent dark background
 */
export function CopyNotification(props: CopyNotificationProps) {
  const theme = useTheme();
  const copyColors = () => theme.ui.copyNotification;
  const bgColor = () => parseRgbaHex(copyColors().backgroundColor, DEFAULT_BG_COLOR);

  return (
    <Show when={props.visible && props.paneRect}>
      {(paneRect: Accessor<PaneRectangle>) => {
        // Position at top-right of pane, with some padding from edges
        const leftPosition = () => Math.max(0, paneRect().x + paneRect().width - TOAST_WIDTH - 2);
        const topPosition = () => paneRect().y + 1;

        return (
          <box
            style={{
              position: 'absolute',
              left: leftPosition(),
              top: topPosition(),
              width: TOAST_WIDTH,
              height: TOAST_HEIGHT,
              backgroundColor: bgColor(),
              zIndex: 250,
              border: ['left', 'right'],
              borderStyle: 'single',
              borderColor: copyColors().borderColor,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <text
              style={{
                fg: copyColors().textColor,
              }}
              content="Copied to clipboard"
            />
          </box>
        );
      }}
    </Show>
  );
}

export default CopyNotification;
