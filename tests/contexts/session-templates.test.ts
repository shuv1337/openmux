/**
 * Tests for session template helpers
 */
import { describe, it, expect } from 'vitest';
import type { Workspaces } from '../../src/core/operations/layout-actions';
import { buildTemplateFromWorkspaces } from '../../src/contexts/session-templates';

describe('buildTemplateFromWorkspaces', () => {
  it('preserves foreground command flags in templates', async () => {
    const workspaces: Workspaces = {
      1: {
        id: 1,
        mainPane: { id: 'pane-1', ptyId: 'pty-1', title: 'shell' },
        stackPanes: [],
        focusedPaneId: 'pane-1',
        activeStackIndex: 0,
        layoutMode: 'vertical',
        zoomed: false,
      },
    };

    const result = await buildTemplateFromWorkspaces({
      name: 'Test Template',
      workspaces,
      getCwd: async () => '/tmp',
      getForegroundProcess: async () => 'claude --dangerously-skip-permissions',
      defaultLayoutMode: 'vertical',
      fallbackCwd: '/fallback',
      now: 123,
      shellPath: '/bin/zsh',
    });

    expect(result).not.toBeNull();
    const template = result!.template;
    const workspace = template.workspaces[0];
    const command = workspace?.panes?.[0]?.command;
    expect(command).toBe('claude --dangerously-skip-permissions');

    const main = workspace?.layout?.main;
    if (main && main.type === 'pane') {
      expect(main.command).toBe('claude --dangerously-skip-permissions');
    }
  });
});
