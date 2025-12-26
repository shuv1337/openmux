/**
 * Layout tree helpers for split panes.
 */

import type { LayoutNode, PaneData, SplitDirection, SplitNode } from './types';

export function isSplitNode(node: LayoutNode): node is SplitNode {
  return (node as SplitNode).type === 'split';
}

export function collectPanes(node: LayoutNode | null, panes: PaneData[] = []): PaneData[] {
  if (!node) return panes;
  if (!isSplitNode(node)) {
    panes.push(node);
    return panes;
  }
  collectPanes(node.first, panes);
  collectPanes(node.second, panes);
  return panes;
}

export function containsPane(node: LayoutNode | null, paneId: string): boolean {
  if (!node) return false;
  if (!isSplitNode(node)) {
    return node.id === paneId;
  }
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}

export function findPane(node: LayoutNode | null, paneId: string): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

export function updatePaneInNode(
  node: LayoutNode,
  paneId: string,
  update: (pane: PaneData) => PaneData
): LayoutNode {
  if (!isSplitNode(node)) {
    if (node.id !== paneId) return node;
    const updated = update(node);
    return updated === node ? node : updated;
  }

  const updatedFirst = updatePaneInNode(node.first, paneId, update);
  const updatedSecond = updatePaneInNode(node.second, paneId, update);
  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function replacePaneWithSplit(
  node: LayoutNode,
  paneId: string,
  newPane: PaneData,
  direction: SplitDirection,
  ratio: number,
  splitId: string
): LayoutNode {
  if (!isSplitNode(node)) {
    if (node.id !== paneId) return node;
    return {
      type: 'split',
      id: splitId,
      direction,
      ratio,
      first: node,
      second: newPane,
    };
  }

  const updatedFirst = replacePaneWithSplit(node.first, paneId, newPane, direction, ratio, splitId);
  const updatedSecond = replacePaneWithSplit(node.second, paneId, newPane, direction, ratio, splitId);
  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function removePaneFromNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (!isSplitNode(node)) {
    return node.id === paneId ? null : node;
  }

  const updatedFirst = removePaneFromNode(node.first, paneId);
  const updatedSecond = removePaneFromNode(node.second, paneId);

  if (!updatedFirst && !updatedSecond) return null;
  if (!updatedFirst) return updatedSecond;
  if (!updatedSecond) return updatedFirst;

  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function getFirstPane(node: LayoutNode | null): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) return node;
  return getFirstPane(node.first) ?? getFirstPane(node.second);
}

export function findSiblingPane(node: LayoutNode, paneId: string): PaneData | null {
  if (!isSplitNode(node)) return null;

  const search = (current: LayoutNode): PaneData | null => {
    if (!isSplitNode(current)) return null;
    if (containsPane(current.first, paneId)) {
      return search(current.first) ?? getFirstPane(current.second);
    }
    if (containsPane(current.second, paneId)) {
      return search(current.second) ?? getFirstPane(current.first);
    }
    return null;
  };

  return search(node);
}
