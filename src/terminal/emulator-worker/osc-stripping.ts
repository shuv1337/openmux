/**
 * OSC sequence stripping for the Emulator Worker
 *
 * Strip OSC sequences that can cause screen flash/flicker when processed by ghostty-web.
 */

/**
 * Strip OSC sequences that can cause screen flash/flicker when processed by ghostty-web.
 *
 * Stripped sequences:
 * - OSC 0/1/2: Title sequences (handled by title parser)
 * - OSC 7: Working directory notification (not needed for rendering)
 * - OSC 10/11/12: Foreground/background/cursor color SET commands (can cause flash)
 * - OSC 22/23: Window icon / title stack (rarely used, can cause issues)
 *
 * Note: Query sequences (with ?) are handled by query passthrough on main thread.
 * This only strips SET commands that go directly to ghostty-web.
 *
 * Format: ESC]code;params BEL  or  ESC]code;params ESC\
 */
export function stripProblematicOscSequences(text: string): string {
  const ESC = '\x1b';
  const BEL = '\x07';

  // OSC codes to strip - these can cause flash/flicker
  const stripCodes = new Set([
    0, 1, 2,    // Title sequences (handled by title parser)
    7,          // Working directory (CWD notification)
    10, 11, 12, // Foreground/background/cursor color (SET commands)
    22, 23,     // Window icon / title stack operations
  ]);

  let result = '';
  let i = 0;

  while (i < text.length) {
    // Check for OSC start (ESC])
    if (text[i] === ESC && i + 1 < text.length && text[i + 1] === ']') {
      let pos = i + 2;
      let codeStr = '';

      // Parse the OSC code number
      while (pos < text.length && /\d/.test(text[pos])) {
        codeStr += text[pos];
        pos++;
      }

      const code = parseInt(codeStr, 10);

      // Check if this is a code we should strip
      if (codeStr.length > 0 && stripCodes.has(code)) {
        // For OSC 10/11/12, only strip if it's a SET (not a query with ?)
        // Query format: OSC 10;? or OSC 10;?ST - these are handled by passthrough
        // Set format: OSC 10;colorspec - these cause flash
        const isColorCode = code === 10 || code === 11 || code === 12;

        if (isColorCode) {
          // Check if next char after code is ; then ?
          // If so, it's a query - don't strip (passthrough handles it)
          if (pos < text.length && text[pos] === ';') {
            if (pos + 1 < text.length && text[pos + 1] === '?') {
              // This is a query, don't strip - include the character and continue
              result += text[i];
              i++;
              continue;
            }
          }
        }

        // Find the terminator (BEL or ST) and skip entire sequence
        while (pos < text.length) {
          if (text[pos] === BEL) {
            // Found BEL terminator, skip entire sequence
            i = pos + 1;
            break;
          }
          if (text[pos] === ESC && pos + 1 < text.length && text[pos + 1] === '\\') {
            // Found ST terminator, skip entire sequence
            i = pos + 2;
            break;
          }
          pos++;
        }

        // If we found and skipped the sequence, continue
        if (i > pos - 1) {
          continue;
        }
        // If no terminator found, include the partial sequence
        // (it will be completed in a future write)
      }
    }

    // Not a stripped sequence, include the character
    result += text[i];
    i++;
  }

  return result;
}
