/** Model IDs use punctuation where users naturally type spaces. Match every
 * partial term, in any order, without requiring accents or exact separators. */
function normalizeModelSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesModelSearch(text: string, query: string): boolean {
  const haystack = normalizeModelSearch(text);
  return normalizeModelSearch(query).split(' ').filter(Boolean)
    .every((term) => haystack.includes(term));
}
