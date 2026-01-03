import { normalizeKeyCombo } from './keybindings';

export type VimSequence = {
  keys: string[];
  action: string;
};

export type VimInputMode = 'normal' | 'insert';

export type VimSequenceResult = {
  action: string | null;
  pending: boolean;
};

export function normalizeVimSequences(sequences: VimSequence[]): VimSequence[] {
  const normalized: VimSequence[] = [];

  for (const sequence of sequences) {
    const keys: string[] = [];
    let valid = true;

    for (const combo of sequence.keys) {
      const normalizedCombo = normalizeKeyCombo(combo);
      if (!normalizedCombo) {
        valid = false;
        break;
      }
      keys.push(normalizedCombo);
    }

    if (valid && keys.length > 0) {
      normalized.push({ keys, action: sequence.action });
    }
  }

  return normalized;
}

export function createVimSequenceHandler(options: {
  sequences: VimSequence[];
  timeoutMs: number;
  onTimeout?: () => void;
}) {
  const sequences = normalizeVimSequences(options.sequences);
  let buffer: string[] = [];
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const clearTimeoutIfNeeded = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const reset = () => {
    buffer = [];
    clearTimeoutIfNeeded();
  };

  const scheduleTimeout = () => {
    clearTimeoutIfNeeded();
    if (options.timeoutMs <= 0) return;
    timeout = setTimeout(() => {
      buffer = [];
      timeout = null;
      options.onTimeout?.();
    }, options.timeoutMs);
  };

  const matchesPrefix = (candidate: string[], sequence: VimSequence) => {
    if (candidate.length > sequence.keys.length) return false;
    for (let i = 0; i < candidate.length; i += 1) {
      if (candidate[i] !== sequence.keys[i]) return false;
    }
    return true;
  };

  const matchSequences = (candidate: string[]) => {
    let isPrefix = false;
    for (const sequence of sequences) {
      if (!matchesPrefix(candidate, sequence)) continue;
      if (candidate.length === sequence.keys.length) {
        return { action: sequence.action, isPrefix: true };
      }
      isPrefix = true;
    }
    return { action: null, isPrefix };
  };

  const handleCombo = (combo: string): VimSequenceResult => {
    if (!combo) return { action: null, pending: false };

    const candidate = [...buffer, combo];
    const match = matchSequences(candidate);

    if (match.action) {
      reset();
      return { action: match.action, pending: false };
    }

    if (match.isPrefix) {
      buffer = candidate;
      scheduleTimeout();
      return { action: null, pending: true };
    }

    if (buffer.length > 0) {
      reset();
      return handleCombo(combo);
    }

    return { action: null, pending: false };
  };

  return {
    handleCombo,
    reset,
  };
}
