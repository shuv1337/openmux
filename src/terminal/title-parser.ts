/**
 * OSC Title Parser - Detects terminal title changes from escape sequences
 *
 * Parses OSC 0/1/2 sequences that set the terminal title:
 * - OSC 0: Set both icon name and window title
 * - OSC 1: Set icon name (we treat as title)
 * - OSC 2: Set window title
 *
 * Format: ESC ] <code> ; <text> BEL  or  ESC ] <code> ; <text> ST
 * Where ST is ESC \
 */

const ESC = '\x1b';
const BEL = '\x07';
const ST = '\x1b\\'; // String Terminator

export interface TitleParserOptions {
  onTitleChange: (title: string) => void;
}

/**
 * Creates a title parser that can be called with data chunks
 */
export function createTitleParser(options: TitleParserOptions) {
  const { onTitleChange } = options;

  // Buffer for accumulating partial sequences
  let buffer = '';
  let inOscSequence = false;
  let oscCode = '';
  let oscText = '';

  /**
   * Process a chunk of data and extract title changes
   */
  function processData(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (inOscSequence) {
        // Check for terminator
        if (char === BEL) {
          // BEL terminates OSC
          handleOscComplete();
          continue;
        }

        if (char === ESC && i + 1 < data.length && data[i + 1] === '\\') {
          // ST (ESC \) terminates OSC
          i++; // Skip the backslash
          handleOscComplete();
          continue;
        }

        // Still collecting OSC sequence
        if (oscCode === '') {
          // Collecting code (until semicolon)
          if (char === ';') {
            // Code complete, now collecting text
          } else if (char >= '0' && char <= '9') {
            oscCode += char;
          } else {
            // Invalid OSC, abort
            resetOsc();
          }
        } else {
          // Collecting text (after semicolon)
          oscText += char;
        }
        continue;
      }

      // Not in OSC sequence - look for start
      if (char === ESC && i + 1 < data.length && data[i + 1] === ']') {
        // Found ESC ] - start of OSC
        inOscSequence = true;
        oscCode = '';
        oscText = '';
        i++; // Skip the ]
        continue;
      }
    }
  }

  function handleOscComplete(): void {
    const code = parseInt(oscCode, 10);

    // OSC 0, 1, 2 all set title (0 sets both icon and title, 1 sets icon, 2 sets title)
    if (code === 0 || code === 1 || code === 2) {
      onTitleChange(oscText);
    }

    resetOsc();
  }

  function resetOsc(): void {
    inOscSequence = false;
    oscCode = '';
    oscText = '';
  }

  return {
    processData,
  };
}
