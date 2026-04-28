/**
 * Pull a 3–5 word phrase chunk off the front of `buf`. Returns null if the
 * buffer doesn't yet contain enough words AND the source stream isn't done.
 * When the stream is done, flushes whatever remains as the final chunk.
 */
export interface ChunkResult {
  chunk: string | null;
  rest: string;
}

export function takeChunk(
  buf: string,
  opts: { streamDone: boolean; minWords?: number; maxWords?: number },
): ChunkResult {
  const minWords = opts.minWords ?? 3;
  const maxWords = opts.maxWords ?? 5;

  if (buf.length === 0) return { chunk: null, rest: buf };

  // Tokenize keeping whitespace so we preserve original spacing/newlines.
  const tokens = buf.split(/(\s+)/);
  let wordCount = 0;
  let endIdx = -1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (/^\s+$/.test(t)) continue;
    wordCount++;
    endIdx = i + 1;
    // Prefer ending on a sentence break once we have minWords.
    if (wordCount >= minWords && /[.!?]$/.test(t)) break;
    if (wordCount >= maxWords) break;
  }

  if (wordCount === 0) return { chunk: null, rest: buf };

  if (wordCount < minWords && !opts.streamDone) {
    // wait for more tokens
    return { chunk: null, rest: buf };
  }

  const chunk = tokens.slice(0, endIdx).join("");
  const rest = tokens.slice(endIdx).join("");
  return { chunk, rest };
}
