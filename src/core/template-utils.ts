/**
 * Template name/id helpers shared across overlays and session save logic.
 */

export function normalizeTemplateId(name: string): string | null {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : null;
}
