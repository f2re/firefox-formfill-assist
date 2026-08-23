export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,;:()[\]{}"'`«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }

  return previous[b.length]!;
}

export function matchConfidence(requested: unknown, candidate: unknown): number {
  const left = normalizeText(requested);
  const right = normalizeText(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftCompact = left.replace(/\b(г|город|обл|область)\b/g, "").replace(/\s+/g, " ").trim();
  const rightCompact = right.replace(/\b(г|город|обл|область)\b/g, "").replace(/\s+/g, " ").trim();
  if (leftCompact && leftCompact === rightCompact) return 0.99;

  if (left.startsWith(right) || right.startsWith(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return 0.9 + 0.08 * ratio;
  }

  const distance = levenshtein(left, right);
  const similarity = 1 - distance / Math.max(left.length, right.length);
  return Math.max(0, Math.min(0.94, similarity));
}

export interface BestMatch {
  value: string;
  confidence: number;
}

export function bestTextMatch(requested: unknown, candidates: string[]): BestMatch | null {
  let best: BestMatch | null = null;
  for (const candidate of candidates) {
    const confidence = matchConfidence(requested, candidate);
    if (!best || confidence > best.confidence) best = { value: candidate, confidence };
  }
  return best;
}
