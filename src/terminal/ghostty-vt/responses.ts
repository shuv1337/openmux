import type { GhosttyVtTerminal } from './terminal';

export function drainTerminalResponses(terminal: GhosttyVtTerminal): string[] {
  const responses: string[] = [];
  while (true) {
    const response = terminal.readResponse();
    if (!response) break;
    responses.push(response);
  }
  return responses;
}
