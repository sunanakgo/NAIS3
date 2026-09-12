/** Fragment references are case-insensitive and permit whitespace around path separators. */
export function normalizeFragmentPath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
}
