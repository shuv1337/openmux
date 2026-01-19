export type GhosttyMock = { symbols: Record<string, any> };

export const mockGhostty: GhosttyMock = {
  symbols: {},
};

export const resetGhosttySymbols = (): void => {
  mockGhostty.symbols = {};
};
