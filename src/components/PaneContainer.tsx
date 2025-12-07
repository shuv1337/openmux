/**
 * PaneContainer - renders master-stack layout panes
 */

import { useCallback, useMemo } from 'react';
import type { PaneData, LayoutMode } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { Pane } from './Pane';

export function PaneContainer() {
  const { activeWorkspace, dispatch } = useLayout();
  const theme = useTheme();
  const { writeToPTY } = useTerminal();

  const handlePaneClick = useCallback((paneId: string) => {
    dispatch({ type: 'FOCUS_PANE', paneId });
  }, [dispatch]);

  const handleMouseInput = useCallback((ptyId: string, data: string) => {
    writeToPTY(ptyId, data);
  }, [writeToPTY]);

  if (!activeWorkspace.mainPane) {
    return (
      <box
        style={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg="#666666">
          No panes. Press Ctrl+b n or Alt+n to create a pane.
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        position: 'relative',
        flexGrow: 1,
      }}
    >
      {/* Render main pane */}
      <PaneRenderer
        pane={activeWorkspace.mainPane}
        isFocused={activeWorkspace.focusedPaneId === activeWorkspace.mainPane.id}
        isMain={true}
        onFocus={handlePaneClick}
        onMouseInput={handleMouseInput}
      />

      {/* Render stack panes */}
      {activeWorkspace.layoutMode === 'stacked' ? (
        // Stacked mode: render tab headers and only the active pane
        <StackedPanesRenderer
          stackPanes={activeWorkspace.stackPanes}
          activeStackIndex={activeWorkspace.activeStackIndex}
          focusedPaneId={activeWorkspace.focusedPaneId}
          onFocus={handlePaneClick}
          onMouseInput={handleMouseInput}
        />
      ) : (
        // Vertical/Horizontal mode: render all stack panes
        activeWorkspace.stackPanes.map((pane) => (
          <PaneRenderer
            key={pane.id}
            pane={pane}
            isFocused={activeWorkspace.focusedPaneId === pane.id}
            isMain={false}
            onFocus={handlePaneClick}
            onMouseInput={handleMouseInput}
          />
        ))
      )}
    </box>
  );
}

interface PaneRendererProps {
  pane: PaneData;
  isFocused: boolean;
  isMain: boolean;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function PaneRenderer({ pane, isFocused, isMain, onFocus, onMouseInput }: PaneRendererProps) {
  const rect = pane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = useCallback(() => {
    onFocus(pane.id);
  }, [onFocus, pane.id]);

  const handleMouseInput = useCallback((data: string) => {
    if (pane.ptyId) {
      onMouseInput(pane.ptyId, data);
    }
  }, [pane.ptyId, onMouseInput]);

  return (
    <Pane
      id={pane.id}
      title={pane.title}
      isFocused={isFocused}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      ptyId={pane.ptyId}
      onClick={handleClick}
      onMouseInput={handleMouseInput}
    />
  );
}

interface StackedPanesRendererProps {
  stackPanes: PaneData[];
  activeStackIndex: number;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function StackedPanesRenderer({
  stackPanes,
  activeStackIndex,
  focusedPaneId,
  onFocus,
  onMouseInput,
}: StackedPanesRendererProps) {
  if (stackPanes.length === 0) return null;

  const activePane = stackPanes[activeStackIndex];
  if (!activePane) return null;

  const rect = activePane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = useCallback(() => {
    onFocus(activePane.id);
  }, [onFocus, activePane.id]);

  const handleTabClick = useCallback((paneId: string) => {
    onFocus(paneId);
  }, [onFocus]);

  const handleMouseInput = useCallback((data: string) => {
    if (activePane.ptyId) {
      onMouseInput(activePane.ptyId, data);
    }
  }, [activePane.ptyId, onMouseInput]);

  // Calculate visible tabs based on scroll offset
  const visibleTabs = useMemo(() => {
    const visibleWidth = rect.width;

    // Build tab info with positions
    const tabItems = stackPanes.map((pane, index) => {
      const isActive = index === activeStackIndex;
      const label = isActive
        ? `[${pane.title ?? 'pane'}]`
        : ` ${pane.title ?? 'pane'} `;
      return { pane, label, width: label.length, isActive, index };
    });

    let pos = 0;
    const tabsWithPos = tabItems.map((tab) => {
      const start = pos;
      pos += tab.width;
      return { ...tab, start, end: pos };
    });

    // Calculate scroll offset to keep active tab visible
    const activeTab = tabsWithPos[activeStackIndex];
    let scrollOffset = 0;
    if (activeTab) {
      if (activeTab.end > visibleWidth) {
        scrollOffset = activeTab.end - visibleWidth;
      }
      if (activeTab.start < scrollOffset) {
        scrollOffset = activeTab.start;
      }
    }

    // Filter and trim tabs to fit visible area
    const result: Array<{ pane: PaneData; label: string; isActive: boolean }> = [];
    for (const tab of tabsWithPos) {
      const visibleStart = scrollOffset;
      const visibleEnd = scrollOffset + visibleWidth;

      // Skip tabs completely outside visible area
      if (tab.end <= visibleStart || tab.start >= visibleEnd) continue;

      // Calculate visible portion of this tab
      const labelStart = Math.max(0, visibleStart - tab.start);
      const labelEnd = Math.min(tab.width, visibleEnd - tab.start);
      const visibleLabel = tab.label.slice(labelStart, labelEnd);

      if (visibleLabel.length > 0) {
        result.push({ pane: tab.pane, label: visibleLabel, isActive: tab.isActive });
      }
    }
    return result;
  }, [stackPanes, activeStackIndex, rect.width]);

  return (
    <>
      {/* Tab headers for stacked panes */}
      <box
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: 1,
          flexDirection: 'row',
        }}
      >
        {visibleTabs.map(({ pane, label, isActive }) => (
          <text
            key={pane.id}
            fg={isActive ? '#00AAFF' : '#666666'}
            onMouseDown={() => handleTabClick(pane.id)}
          >
            {label}
          </text>
        ))}
      </box>

      {/* Active pane (offset by 1 for tab header) */}
      <Pane
        id={activePane.id}
        title={activePane.title}
        isFocused={focusedPaneId === activePane.id}
        x={rect.x}
        y={rect.y + 1}
        width={rect.width}
        height={Math.max(1, rect.height - 1)}
        ptyId={activePane.ptyId}
        onClick={handleClick}
        onMouseInput={handleMouseInput}
      />
    </>
  );
}
