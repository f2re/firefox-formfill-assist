import type { FormManifest } from "./types";
import { makeGptPacket } from "./gpt";
import {
  currentSessionPage,
  isFormSessionExpired,
  relationToSession,
  sessionMatchesManifest,
  type FormSession,
} from "./session";

export interface AiHandoffPlan {
  prompt: string;
  pageFingerprint: string;
  fieldCount: number;
  pageNumber?: number;
  fieldNamespace: string;
}

export class AiHandoffSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiHandoffSessionError";
  }
}

export function planAiHandoff(manifest: FormManifest, session?: FormSession | null): AiHandoffPlan {
  if (!session) {
    return {
      prompt: makeGptPacket(manifest),
      pageFingerprint: manifest.pageFingerprint,
      fieldCount: manifest.fields.length,
      fieldNamespace: "Fxx / I<n>-Fxx",
    };
  }

  if (isFormSessionExpired(session)) {
    throw new AiHandoffSessionError("Многостраничная сессия истекла. Завершите её и начните новую.");
  }

  const relation = relationToSession(session, manifest);
  if (relation.kind !== "current" || !sessionMatchesManifest(session, manifest)) {
    if (relation.kind === "known") {
      throw new AiHandoffSessionError(
        `Открыта страница ${relation.page.pageNumber} этой сессии, но она не подтверждена как текущая. Сначала подтвердите переход в основном интерфейсе.`,
      );
    }
    throw new AiHandoffSessionError(
      `Обнаружена новая страница формы. Сначала нажмите «Продолжить текущую сессию», затем подготовьте снимок для ИИ.`,
    );
  }

  const page = currentSessionPage(session);
  if (!page) throw new AiHandoffSessionError("В активной сессии нет текущей страницы.");

  return {
    prompt: makeGptPacket(manifest, { sessionId: session.id, pageNumber: page.pageNumber }),
    pageFingerprint: manifest.pageFingerprint,
    fieldCount: manifest.fields.length,
    pageNumber: page.pageNumber,
    fieldNamespace: `P${page.pageNumber}-Fxx / P${page.pageNumber}-I<n>-Fxx`,
  };
}

export function aiCaptureFilename(capturedAt: string, pageNumber?: number): string {
  const safeTime = capturedAt.replace(/[:.]/g, "-");
  const page = pageNumber ? `-p${pageNumber}` : "";
  return `formfill-ai${page}-${safeTime}.png`;
}
