/**
 * Template-related helpers for session context.
 */

import type { Workspaces } from '../core/operations/layout-actions';
import type { LayoutMode, WorkspaceId, LayoutNode, PaneData } from '../core/types';
import { normalizeTemplateId } from '../core/template-utils';
import { isSplitNode } from '../core/layout-tree';
import { WorkspaceId as EffectWorkspaceId } from '../effect/types';
import {
  TemplateSession,
  TemplateDefaults,
  TemplateWorkspace,
  TemplatePaneData,
  TemplateLayoutPane,
  TemplateLayoutSplit,
  TemplateWorkspaceLayout,
  type TemplateLayoutNode,
} from '../effect/models';
import { buildLayoutFromTemplate } from '../effect/bridge/template-layout';

export function isLayoutEmpty(workspaces: Workspaces): boolean {
  return Object.values(workspaces).every((workspace) =>
    !workspace || (!workspace.mainPane && workspace.stackPanes.length === 0)
  );
}

function normalizeCommand(command: string | undefined, shellPath: string, shellName: string | null | undefined): string | undefined {
  if (!command) return undefined;
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('defunct')) return undefined;
  if (shellName && trimmed === shellName) return undefined;
  if (shellPath && trimmed === shellPath) return undefined;
  return trimmed;
}

export async function buildTemplateFromWorkspaces(params: {
  name: string;
  workspaces: Workspaces;
  getCwd: (ptyId: string) => Promise<string>;
  getForegroundProcess: (ptyId: string) => Promise<string | undefined>;
  defaultLayoutMode: LayoutMode;
  fallbackCwd: string;
  now?: number;
  shellPath?: string;
}): Promise<{ template: TemplateSession; templateId: string } | null> {
  const workspaceEntries = Object.entries(params.workspaces)
    .map(([idStr, workspace]) => ({ id: Number(idStr), workspace }))
    .filter(({ workspace }) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0))
    .sort((a, b) => a.id - b.id);

  if (workspaceEntries.length === 0) {
    return null;
  }

  const now = params.now ?? Date.now();
  const normalizedId = normalizeTemplateId(params.name);
  const templateId = normalizedId ?? `template-${now}`;

  const templateWorkspaces: TemplateWorkspace[] = [];
  let maxPaneCount = 1;
  let unifiedCwd: string | null = null;
  let cwdIsUniform = true;
  const shellPath = params.shellPath ?? '';
  const shellName = shellPath ? shellPath.split('/').pop() : null;

  const resolvePaneMetadata = async (pane: PaneData) => {
    let cwd = params.fallbackCwd;
    let command: string | undefined;
    if (pane.ptyId) {
      try {
        cwd = await params.getCwd(pane.ptyId);
      } catch {
        cwd = params.fallbackCwd;
      }
      try {
        command = await params.getForegroundProcess(pane.ptyId);
      } catch {
        command = undefined;
      }
    }
    return {
      cwd,
      command: normalizeCommand(command, shellPath, shellName),
    };
  };

  const buildLayoutNode = async (
    node: LayoutNode,
    leafMetadata: Array<{ cwd: string; command?: string }>
  ): Promise<TemplateLayoutNode> => {
    if (isSplitNode(node)) {
      const first = await buildLayoutNode(node.first, leafMetadata);
      const second = await buildLayoutNode(node.second, leafMetadata);
      return TemplateLayoutSplit.make({
        type: 'split',
        direction: node.direction,
        ratio: node.ratio,
        first,
        second,
      });
    }

    const metadata = await resolvePaneMetadata(node);
    leafMetadata.push(metadata);
    return TemplateLayoutPane.make({
      type: 'pane',
      cwd: metadata.cwd,
      command: metadata.command,
    });
  };

  for (const entry of workspaceEntries) {
    const workspace = entry.workspace;
    if (!workspace) continue;
    const workspaceId = EffectWorkspaceId.make(entry.id);
    const panes: TemplatePaneData[] = [];
    const leafMetadata: Array<{ cwd: string; command?: string }> = [];

    const mainLayout = workspace.mainPane
      ? await buildLayoutNode(workspace.mainPane, leafMetadata)
      : null;
    const stackLayout: TemplateLayoutNode[] = [];
    for (const pane of workspace.stackPanes) {
      stackLayout.push(await buildLayoutNode(pane, leafMetadata));
    }

    for (const [index, metadata] of leafMetadata.entries()) {
      panes.push(
        TemplatePaneData.make({
          role: index === 0 ? 'main' : 'stack',
          cwd: metadata.cwd,
          command: metadata.command,
        })
      );
      if (!unifiedCwd) {
        unifiedCwd = metadata.cwd;
      } else if (unifiedCwd !== metadata.cwd) {
        cwdIsUniform = false;
      }
    }

    maxPaneCount = Math.max(maxPaneCount, leafMetadata.length);

    templateWorkspaces.push(
      TemplateWorkspace.make({
        id: workspaceId,
        layoutMode: workspace.layoutMode,
        panes,
        layout: TemplateWorkspaceLayout.make({
          main: mainLayout,
          stack: stackLayout,
        }),
      })
    );
  }

  const defaults = TemplateDefaults.make({
    workspaceCount: Math.min(9, Math.max(1, workspaceEntries.length)),
    paneCount: maxPaneCount,
    layoutMode: params.defaultLayoutMode,
    cwd: cwdIsUniform && unifiedCwd ? unifiedCwd : undefined,
  });

  const template = TemplateSession.make({
    version: 1,
    id: templateId,
    name: params.name,
    createdAt: now,
    updatedAt: now,
    defaults,
    workspaces: templateWorkspaces,
  });

  return { template, templateId };
}

export async function applyTemplateToSession(params: {
  template: TemplateSession;
  activeSessionId: string | null;
  resetLayoutForTemplate: () => Promise<void>;
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string
  ) => Promise<void>;
}): Promise<void> {
  if (!params.activeSessionId) return;

  await params.resetLayoutForTemplate();
  const layout = buildLayoutFromTemplate(params.template);
  await params.onSessionLoad(
    layout.workspaces,
    layout.activeWorkspaceId,
    layout.cwdMap,
    layout.commandMap,
    params.activeSessionId
  );
}
