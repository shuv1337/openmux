import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../../src/cli/parse';

describe('cli parser', () => {
  test('defaults to attach when no args', () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({ ok: true, command: { kind: 'attach' } });
  });

  test('parses --help at root', () => {
    const result = parseCliArgs(['--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'root' } });
  });

  test('parses help topic for pane capture', () => {
    const result = parseCliArgs(['pane', 'capture', '--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'pane.capture' } });
  });

  test('parses attach --session', () => {
    const result = parseCliArgs(['attach', '--session', 'dev']);
    expect(result).toEqual({ ok: true, command: { kind: 'attach', session: 'dev' } });
  });

  test('parses session list --json', () => {
    const result = parseCliArgs(['session', 'list', '--json']);
    expect(result).toEqual({ ok: true, command: { kind: 'session.list', json: true } });
  });

  test('parses pane split', () => {
    const result = parseCliArgs(['pane', 'split', '--direction', 'vertical', '--workspace', '2', '--pane', 'stack:1']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.split',
        direction: 'vertical',
        workspaceId: 2,
        pane: 'stack:1',
      },
    });
  });

  test('parses pane send', () => {
    const result = parseCliArgs(['pane', 'send', '--text', 'npm test\n']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.send',
        text: 'npm test\n',
      },
    });
  });

  test('unescapes pane send text', () => {
    const result = parseCliArgs(['pane', 'send', '--text', 'echo\\nline']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.send',
        text: 'echo\nline',
      },
    });
  });

  test('parses pane capture --raw', () => {
    const result = parseCliArgs(['pane', 'capture', '--lines', '10', '--raw']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.capture',
        format: 'text',
        lines: 10,
        raw: true,
      },
    });
  });

  test('reports missing direction', () => {
    const result = parseCliArgs(['pane', 'split']);
    expect(result.ok).toBe(false);
  });
});
