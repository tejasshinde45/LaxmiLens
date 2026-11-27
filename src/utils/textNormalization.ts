/**
 * Normalizes optional string fields so empty or whitespace-only values collapse
 * consistently to `undefined` while non-empty values preserve trimmed text.
 */
export function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
