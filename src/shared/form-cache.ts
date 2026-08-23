import type { FillResult, FieldDescriptor, FormManifest } from "./types";
import { fnv1a } from "./fingerprint";
import { normalizeText } from "./normalize";

export const KNOWN_FORM_CACHE_VERSION = 1;
export const KNOWN_FORM_CACHE_MAX_ENTRIES = 20;
export const KNOWN_FORM_CACHE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const KNOWN_FORM_REBIND_THRESHOLD = 0.85;
export const KNOWN_FORM_REBIND_MARGIN = 0.08;

export interface CachedFieldSignature {
  cachedId: string;
  type: FieldDescriptor["type"];
  tag: string;
  inputType?: string;
  name?: string;
  domId?: string;
  label: string;
  ariaLabel?: string;
  formIndex: number;
  sensitive: boolean;
}

export interface KnownFormEntry {
  version: 1;
  key: string;
  origin: string;
  pathname: string;
  pageFingerprint: string;
  fieldCount: number;
  fields: CachedFieldSignature[];
  firstUsedAt: string;
  lastUsedAt: string;
  successCount: number;
  reviewCount: number;
  errorCount: number;
}

export interface KnownFormCache {
  version: 1;
  entries: KnownFormEntry[];
}

export interface KnownFormBinding {
  cachedId: string;
  currentId: string;
  confidence: number;
}

export type KnownFormAssessment =
  | { kind: "unknown" }
  | { kind: "changed"; entry: KnownFormEntry; reason: string }
  | {
      kind: "recognized";
      entry: KnownFormEntry;
      bindings: KnownFormBinding[];
      unmappedCachedIds: string[];
      confidence: number;
    };

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function pageIdentity(page: string): { origin: string; pathname: string } {
  const url = new URL(page);
  return { origin: url.origin, pathname: url.pathname };
}

function signatureOf(field: FieldDescriptor): CachedFieldSignature {
  return {
    cachedId: field.id,
    type: field.type,
    tag: field.fingerprint.tag,
    inputType: field.fingerprint.inputType,
    name: field.fingerprint.name,
    domId: field.fingerprint.domId,
    label: field.label,
    ariaLabel: field.fingerprint.ariaLabel,
    formIndex: field.fingerprint.formIndex,
    sensitive: field.sensitive,
  };
}

function knownFormKey(manifest: FormManifest): string {
  const { origin, pathname } = pageIdentity(manifest.page);
  return fnv1a(`${origin}\n${pathname}\n${manifest.pageFingerprint}`);
}

export function createEmptyKnownFormCache(): KnownFormCache {
  return { version: KNOWN_FORM_CACHE_VERSION, entries: [] };
}

export function createKnownFormEntry(
  manifest: FormManifest,
  result?: FillResult,
  now = Date.now(),
): KnownFormEntry {
  const { origin, pathname } = pageIdentity(manifest.page);
  const timestamp = nowIso(now);
  return {
    version: KNOWN_FORM_CACHE_VERSION,
    key: knownFormKey(manifest),
    origin,
    pathname,
    pageFingerprint: manifest.pageFingerprint,
    fieldCount: manifest.fields.length,
    fields: manifest.fields.map(signatureOf),
    firstUsedAt: timestamp,
    lastUsedAt: timestamp,
    successCount: result ? result.filled + result.same : 0,
    reviewCount: result?.review ?? 0,
    errorCount: result?.errors ?? 0,
  };
}

export function pruneKnownFormCache(cache: KnownFormCache, now = Date.now()): KnownFormCache {
  const retained = cache.entries
    .filter((entry) => {
      const lastUsed = Date.parse(entry.lastUsedAt);
      return Number.isFinite(lastUsed) && now - lastUsed <= KNOWN_FORM_CACHE_RETENTION_MS;
    })
    .sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt))
    .slice(0, KNOWN_FORM_CACHE_MAX_ENTRIES);
  return { version: KNOWN_FORM_CACHE_VERSION, entries: retained };
}

export function rememberKnownForm(
  cache: KnownFormCache,
  manifest: FormManifest,
  result?: FillResult,
  now = Date.now(),
): KnownFormCache {
  const clean = pruneKnownFormCache(cache, now);
  const key = knownFormKey(manifest);
  const previous = clean.entries.find((entry) => entry.key === key);
  const fresh = createKnownFormEntry(manifest, result, now);
  const merged: KnownFormEntry = previous
    ? {
        ...fresh,
        firstUsedAt: previous.firstUsedAt,
        successCount: previous.successCount + fresh.successCount,
        reviewCount: previous.reviewCount + fresh.reviewCount,
        errorCount: previous.errorCount + fresh.errorCount,
      }
    : fresh;

  return pruneKnownFormCache(
    {
      version: KNOWN_FORM_CACHE_VERSION,
      entries: [merged, ...clean.entries.filter((entry) => entry.key !== key)],
    },
    now,
  );
}

function exactOptional(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left === right);
}

function signatureScore(cached: CachedFieldSignature, current: FieldDescriptor): number {
  if (cached.type !== current.type) return 0;
  if (cached.sensitive !== current.sensitive) return 0;

  let score = 0.1;
  if (cached.tag === current.fingerprint.tag) score += 0.05;
  if (cached.inputType === current.fingerprint.inputType) score += 0.05;
  if (normalizeText(cached.label) === normalizeText(current.label)) score += 0.2;
  if (exactOptional(cached.name, current.fingerprint.name)) score += 0.25;
  if (exactOptional(cached.domId, current.fingerprint.domId)) score += 0.3;
  if (exactOptional(cached.ariaLabel, current.fingerprint.ariaLabel)) score += 0.05;
  if (cached.formIndex === current.fingerprint.formIndex) score += 0.05;

  return Math.min(1, score);
}

function bindCachedFields(entry: KnownFormEntry, manifest: FormManifest): {
  bindings: KnownFormBinding[];
  unmappedCachedIds: string[];
  confidence: number;
} {
  const available = new Map(manifest.fields.map((field) => [field.id, field]));
  const bindings: KnownFormBinding[] = [];
  const unmappedCachedIds: string[] = [];

  for (const cached of entry.fields) {
    const ranked = Array.from(available.values())
      .map((current) => ({ current, score: signatureScore(cached, current) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const second = ranked[1];
    const margin = best ? best.score - (second?.score ?? 0) : 0;

    if (!best || best.score < KNOWN_FORM_REBIND_THRESHOLD || margin < KNOWN_FORM_REBIND_MARGIN) {
      unmappedCachedIds.push(cached.cachedId);
      continue;
    }

    bindings.push({
      cachedId: cached.cachedId,
      currentId: best.current.id,
      confidence: best.score,
    });
    available.delete(best.current.id);
  }

  const confidence = bindings.length
    ? bindings.reduce((sum, binding) => sum + binding.confidence, 0) / entry.fields.length
    : 0;
  return { bindings, unmappedCachedIds, confidence };
}

function structuralDifferenceReason(entry: KnownFormEntry, manifest: FormManifest): string {
  if (entry.fieldCount !== manifest.fields.length) {
    return `Количество полей изменилось: было ${entry.fieldCount}, стало ${manifest.fields.length}.`;
  }
  return "Fingerprint формы изменился; прежняя структура не используется автоматически.";
}

export function assessKnownForm(cache: KnownFormCache, manifest: FormManifest, now = Date.now()): KnownFormAssessment {
  const clean = pruneKnownFormCache(cache, now);
  const { origin, pathname } = pageIdentity(manifest.page);
  const sameLocation = clean.entries.filter((entry) => entry.origin === origin && entry.pathname === pathname);
  if (!sameLocation.length) return { kind: "unknown" };

  const exact = sameLocation.find((entry) => entry.pageFingerprint === manifest.pageFingerprint);
  if (!exact) {
    return {
      kind: "changed",
      entry: sameLocation[0]!,
      reason: structuralDifferenceReason(sameLocation[0]!, manifest),
    };
  }

  if (exact.fieldCount !== manifest.fields.length) {
    return { kind: "changed", entry: exact, reason: structuralDifferenceReason(exact, manifest) };
  }

  const binding = bindCachedFields(exact, manifest);
  const unsafeUnmapped = binding.unmappedCachedIds.filter((id) => {
    const signature = exact.fields.find((field) => field.cachedId === id);
    return signature && !signature.sensitive;
  });
  if (unsafeUnmapped.length) {
    return {
      kind: "changed",
      entry: exact,
      reason: `Не удалось однозначно перепривязать поля: ${unsafeUnmapped.join(", ")}. Требуется новый анализ.`,
    };
  }

  return {
    kind: "recognized",
    entry: exact,
    bindings: binding.bindings,
    unmappedCachedIds: binding.unmappedCachedIds,
    confidence: binding.confidence,
  };
}

export function removeKnownForm(cache: KnownFormCache, key: string): KnownFormCache {
  return { version: KNOWN_FORM_CACHE_VERSION, entries: cache.entries.filter((entry) => entry.key !== key) };
}

export function clearKnownForms(): KnownFormCache {
  return createEmptyKnownFormCache();
}
