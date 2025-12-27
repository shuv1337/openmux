/**
 * OSC Command Parser - Captures openmux shell hook commands.
 *
 * Parses OSC 777 sequences of the form:
 *   ESC ] 777 ; openmux ; cmd=<encoded> BEL
 *   ESC ] 777 ; openmux ; cmd=<encoded> ST
 *
 * Where <encoded> is percent-encoded to avoid control characters.
 */

const ESC = '\x1b';
const BEL = '\x07';
const COMMAND_CODE = 777;
const COMMAND_PREFIX = 'openmux;cmd=';

export interface CommandParserOptions {
  onCommand: (command: string) => void;
  shellName?: string;
}

function decodeCommand(encoded: string): string {
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function stripZshPromptEolMark(command: string): string {
  const trimmed = command.trimEnd();
  if (!trimmed.endsWith('%')) return trimmed;

  const before = trimmed.slice(0, -1);
  if (before.endsWith('%')) {
    return trimmed;
  }

  const lastToken = trimmed.split(/\s+/).pop() ?? '';
  if (/^\d+%$/.test(lastToken)) {
    return trimmed;
  }

  return before.trimEnd();
}

function sanitizeCommand(command: string, shellName?: string): string {
  let result = command.trim();
  if (!result) return '';
  if ((shellName ?? '').toLowerCase() === 'zsh') {
    result = stripZshPromptEolMark(result).trim();
  }
  return result;
}

/**
 * Creates a command parser that can be called with data chunks.
 */
export function createCommandParser(options: CommandParserOptions) {
  const { onCommand, shellName } = options;

  // State for OSC sequence parsing
  let inOscSequence = false;
  let collectingText = false;
  let oscCodeBuffer: string[] = [];
  let oscTextBuffer: string[] = [];

  function processData(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (inOscSequence) {
        if (char === BEL) {
          handleOscComplete();
          continue;
        }

        if (char === ESC && i + 1 < data.length && data[i + 1] === '\\') {
          i += 1;
          handleOscComplete();
          continue;
        }

        if (!collectingText) {
          if (char === ';') {
            collectingText = true;
          } else if (char >= '0' && char <= '9') {
            oscCodeBuffer.push(char);
          } else {
            resetOsc();
          }
        } else {
          oscTextBuffer.push(char);
        }
        continue;
      }

      if (char === ESC && i + 1 < data.length && data[i + 1] === ']') {
        inOscSequence = true;
        collectingText = false;
        oscCodeBuffer = [];
        oscTextBuffer = [];
        i += 1;
      }
    }
  }

  function handleOscComplete(): void {
    const oscCode = oscCodeBuffer.join('');
    const oscText = oscTextBuffer.join('');
    const code = Number.parseInt(oscCode, 10);

    if (code === COMMAND_CODE && oscText.startsWith(COMMAND_PREFIX)) {
      const encoded = oscText.slice(COMMAND_PREFIX.length);
      const decoded = decodeCommand(encoded);
      const sanitized = sanitizeCommand(decoded, shellName);
      if (sanitized) {
        onCommand(sanitized);
      }
    }

    resetOsc();
  }

  function resetOsc(): void {
    inOscSequence = false;
    collectingText = false;
    oscCodeBuffer = [];
    oscTextBuffer = [];
  }

  return {
    processData,
  };
}
