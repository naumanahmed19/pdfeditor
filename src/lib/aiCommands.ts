/** Parse an unambiguous page-navigation instruction. Returns a one-based page. */
export function parsePageNavigation(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/\b(?:nevigate|naviagte|nagivate|navigete)\b/gi, "navigate");
  const match = normalized.match(
    /^(?:(?:please|can you|could you|would you)\s+)*(?:(?:go|jump|navigate)\s+(?:to\s+)?|(?:open|show)\s+(?:me\s+)?|take\s+me\s+to\s+)(?:page\s+)?(\d{1,6})(?:\s+please)?[.!?]*$/i,
  );
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}
