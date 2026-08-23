import type { FillRequest, FillResult, FormManifest } from "./types";

export const FORM_SESSION_STORAGE_KEY = "activeFormSession";
export const FORM_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionPageSummary {
  pageNumber: number;
  page: string;
  pageFingerprint: string;
  fieldCount: number;
  startedAt: string;
  completedAt?: string;
  filled?: number;
  same?: number;
  review?: number;
  errors?: number;
}

export interface FormSession {
  version: 1;
  id: string;
  startedAt: string;
  updatedAt: string;
  currentPage: number;
  pages: SessionPageSummary[];
}

export type SessionManifestRelation =
  | { kind: "unbound"; suggestedPage: 1 }
  | { kind: "current"; page: SessionPageSummary }
  | { kind: "known"; page: SessionPageSummary }
  | { kind: "candidate"; suggestedPage: number };

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function randomSessionId(): string {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoObject?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function pageSummary(manifest: FormManifest, pageNumber: number, now = Date.now()): SessionPageSummary {
  return {
    pageNumber,
    page: safePageUrl(manifest.page),
    pageFingerprint: manifest.pageFingerprint,
    fieldCount: manifest.fields.length,
    startedAt: nowIso(now),
  };
}

export function createFormSession(now = Date.now(), id = randomSessionId()): FormSession {
  const timestamp = nowIso(now);
  return {
    version: 1,
    id,
    startedAt: timestamp,
    updatedAt: timestamp,
    currentPage: 0,
    pages: [],
  };
}

export function isFormSessionExpired(session: FormSession, now = Date.now()): boolean {
  const updated = Date.parse(session.updatedAt);
  return !Number.isFinite(updated) || now - updated > FORM_SESSION_TTL_MS;
}

export function relationToSession(session: FormSession, manifest: FormManifest): SessionManifestRelation {
  if (!session.pages.length) return { kind: "unbound", suggestedPage: 1 };

  const known = session.pages.find((page) => page.pageFingerprint === manifest.pageFingerprint);
  if (known) {
    return known.pageNumber === session.currentPage
      ? { kind: "current", page: known }
      : { kind: "known", page: known };
  }

  return {
    kind: "candidate",
    suggestedPage: Math.max(...session.pages.map((page) => page.pageNumber)) + 1,
  };
}

export function acceptManifestInSession(
  session: FormSession,
  manifest: FormManifest,
  now = Date.now(),
): FormSession {
  const relation = relationToSession(session, manifest);
  const timestamp = nowIso(now);

  if (relation.kind === "current") {
    return { ...session, updatedAt: timestamp };
  }

  if (relation.kind === "known") {
    return { ...session, currentPage: relation.page.pageNumber, updatedAt: timestamp };
  }

  const pageNumber = relation.suggestedPage;
  return {
    ...session,
    currentPage: pageNumber,
    updatedAt: timestamp,
    pages: [...session.pages, pageSummary(manifest, pageNumber, now)],
  };
}

export function currentSessionPage(session: FormSession): SessionPageSummary | null {
  return session.pages.find((page) => page.pageNumber === session.currentPage) ?? null;
}

export function sessionMatchesManifest(session: FormSession, manifest: FormManifest): boolean {
  const page = currentSessionPage(session);
  return Boolean(page && page.pageFingerprint === manifest.pageFingerprint);
}

export function qualifySessionFieldId(pageNumber: number, fieldId: string): string {
  if (!/^F\d{2,}$/.test(fieldId)) throw new Error(`Нельзя создать session ID из ${fieldId}.`);
  return `P${pageNumber}-${fieldId}`;
}

export function normalizeSessionFillRequest(
  request: FillRequest,
  session: FormSession,
  manifest: FormManifest,
): FillRequest {
  const page = currentSessionPage(session);
  if (!page) throw new Error("Сессия ещё не привязана к странице формы.");
  if (page.pageFingerprint !== manifest.pageFingerprint) {
    throw new Error("SESSION_PAGE_CHANGED: текущая форма не соответствует активной странице сессии.");
  }
  if (request.pageFingerprint && request.pageFingerprint !== page.pageFingerprint) {
    throw new Error("SESSION_PAGE_MISMATCH: JSON создан для другой страницы сессии.");
  }

  const prefix = `P${page.pageNumber}-`;
  const fields: FillRequest["fields"] = {};
  for (const [qualifiedId, value] of Object.entries(request.fields)) {
    if (!qualifiedId.startsWith(prefix)) {
      const pageMatch = /^P(\d+)-F\d{2,}$/.exec(qualifiedId);
      if (pageMatch) {
        throw new Error(
          `SESSION_PAGE_MISMATCH: ${qualifiedId} относится к странице ${pageMatch[1]}, активна страница ${page.pageNumber}.`,
        );
      }
      throw new Error(`В активной сессии ожидаются идентификаторы вида ${prefix}F01.`);
    }

    const localId = qualifiedId.slice(prefix.length);
    if (!/^F\d{2,}$/.test(localId)) throw new Error(`Некорректный идентификатор сессии: ${qualifiedId}.`);
    fields[localId] = value;
  }

  return {
    version: 1,
    pageFingerprint: page.pageFingerprint,
    fields,
  };
}

export function recordSessionFillResult(
  session: FormSession,
  manifest: FormManifest,
  result: FillResult,
  now = Date.now(),
): FormSession {
  const page = currentSessionPage(session);
  if (!page || page.pageFingerprint !== manifest.pageFingerprint) return session;

  const completedAt = result.completedAt || nowIso(now);
  const pages = session.pages.map((candidate) =>
    candidate.pageNumber === page.pageNumber
      ? {
          ...candidate,
          completedAt,
          filled: result.filled,
          same: result.same,
          review: result.review,
          errors: result.errors,
        }
      : candidate,
  );

  return {
    ...session,
    pages,
    updatedAt: nowIso(now),
  };
}

export function sessionPagePrefix(session: FormSession): string | null {
  const page = currentSessionPage(session);
  return page ? `P${page.pageNumber}-` : null;
}
