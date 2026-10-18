// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Look up's "Find" says which way to turn ("Jupiter: turn left 40°, up 12°") and rewrites it every frame as the phone
// moves. On screen that is right; read aloud it would be a stream of numbers. The gate lets a screen reader hear it only
// when the instruction changes kind (turn left -> turn right -> There it is!), at most once every few seconds; a change
// that comes too soon is said once the wait is over, if it still holds. DOM-free: lookup.js hands the words to
// OOApp.announce.

/** The kind of a guide() instruction: its words without the numbers ("turn left 40°, up 12°" -> "turn left, up"). */
export function guideKind(text) {
  return String(text || '').replace(/-?\d+(\.\d+)?\s*°?/g, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{ minMs?: number }} [opts]
 * @returns {{ next(text: string, now: number): string | null, reset(): void }}
 */
export function speakGate({ minMs = 3000 } = {}) {
  let said = null, at = -Infinity;
  return {
    /** The words to announce now, or null (empty, the same kind as last said, or too soon after it). */
    next(text, now) {
      if (!text) return null;
      const kind = guideKind(text);
      if (kind === said || now - at < minMs) return null;
      said = kind; at = now;
      return text;
    },
    /** A new target, or none: the next instruction is said whatever its kind, once the wait is over. */
    reset() { said = null; },
  };
}
