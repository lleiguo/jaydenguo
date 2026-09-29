// HTTP range requests for the playback copy (intent 0003, PLAY-3): browsers
// ask for `bytes=a-b`, `bytes=a-` or `bytes=-n` to seek. Only a single range
// is served; anything else gets the whole file, as RFC 9110 allows.

export type ByteRange = { start: number; end: number }; // both inclusive

export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // The last n bytes.
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end };
}
