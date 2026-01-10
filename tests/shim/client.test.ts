import { beforeEach, describe, expect, test, vi } from 'vitest';

const ptyStates = new Map<string, { title: string }>();

vi.mock('../../src/shim/client/state', () => ({
  getPtyState: vi.fn((ptyId: string) => ptyStates.get(ptyId)),
  handlePtyTitle: vi.fn((ptyId: string, title: string) => {
    const existing = ptyStates.get(ptyId);
    if (existing) {
      existing.title = title;
      return;
    }
    ptyStates.set(ptyId, { title });
  }),
  registerEmulatorFactory: vi.fn(),
  getKittyState: vi.fn(),
  setPtyState: vi.fn(),
}));

vi.mock('../../src/shim/client/connection', () => ({
  sendRequest: vi.fn(),
}));

import { getTitle } from '../../src/shim/client';
import { getPtyState, handlePtyTitle } from '../../src/shim/client/state';
import { sendRequest } from '../../src/shim/client/connection';

describe('shim client getTitle', () => {
  beforeEach(() => {
    ptyStates.clear();
    vi.clearAllMocks();
  });

  test('returns cached non-empty titles without requesting', async () => {
    ptyStates.set('pty-1', { title: 'Opencode' });

    const title = await getTitle('pty-1');

    expect(title).toBe('Opencode');
    expect(vi.mocked(sendRequest)).not.toHaveBeenCalled();
    expect(vi.mocked(handlePtyTitle)).not.toHaveBeenCalled();
    expect(vi.mocked(getPtyState)).toHaveBeenCalled();
  });

  test('refreshes empty cached titles from the shim', async () => {
    ptyStates.set('pty-2', { title: '' });
    vi.mocked(sendRequest).mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const title = await getTitle('pty-2');

    expect(title).toBe('shell');
    expect(vi.mocked(sendRequest)).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-2' });
    expect(vi.mocked(handlePtyTitle)).toHaveBeenCalledWith('pty-2', 'shell');
    expect(ptyStates.get('pty-2')?.title).toBe('shell');
  });

  test('requests title when no cache exists', async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const title = await getTitle('pty-3');

    expect(title).toBe('shell');
    expect(vi.mocked(sendRequest)).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-3' });
    expect(vi.mocked(handlePtyTitle)).toHaveBeenCalledWith('pty-3', 'shell');
    expect(ptyStates.get('pty-3')?.title).toBe('shell');
  });
});
