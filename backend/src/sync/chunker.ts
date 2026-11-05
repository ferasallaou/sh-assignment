/**
 * Cuts a record's text into searchable pieces.
 *
 * Simple on purpose: split on blank lines (paragraphs, Markdown sections), then
 * pack paragraphs together until a piece would pass `maxChars`. Each piece starts
 * with the record title, so a piece found on its own still says what it belongs to.
 *
 * Production would use token-based sizes, overlap between pieces, and
 * format-aware splitting (tables, PDFs).
 */
export function splitIntoChunks(title: string, content: string, maxChars = 800): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) return [title];

  const pieces: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      pieces.push(current);
      current = '';
    }
    // A single paragraph longer than maxChars stays whole rather than being cut mid-sentence.
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) pieces.push(current);

  return pieces.map((piece) => `${title}\n\n${piece}`);
}
