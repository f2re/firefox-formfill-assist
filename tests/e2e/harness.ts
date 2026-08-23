import { fillRequest, undoLast } from "../../src/content/filler";
import { previewFill } from "../../src/content/preview";
import { scanDocument, type ScanState } from "../../src/content/scanner";
import { makeGptPacket } from "../../src/shared/gpt";
import {
  acceptManifestInSession,
  createFormSession,
  currentSessionPage,
  normalizeSessionFillRequest,
  relationToSession,
  type FormSession,
} from "../../src/shared/session";
import type { FillRequest, FormManifest } from "../../src/shared/types";

let state: ScanState | null = null;
let mutationRevision = 0;
let session: FormSession | null = null;

function requireState(): ScanState {
  if (!state) throw new Error("E2E harness: scan() must be called first");
  return state;
}

function requireSession(): FormSession {
  if (!session) throw new Error("E2E harness: startSession() must be called first");
  return session;
}

const api = {
  scan() {
    state = scanDocument(mutationRevision);
    return state.manifest;
  },
  rescan() {
    mutationRevision += 1;
    state = scanDocument(mutationRevision);
    return state.manifest;
  },
  preview(request: FillRequest) {
    return previewFill(requireState(), request);
  },
  async fill(request: FillRequest) {
    return fillRequest(requireState(), request, mutationRevision);
  },
  async undo() {
    return undoLast(requireState());
  },
  startSession(manifest: FormManifest) {
    session = acceptManifestInSession(createFormSession(Date.now(), "e2e-session"), manifest);
    return session;
  },
  sessionRelation(manifest: FormManifest) {
    return relationToSession(requireSession(), manifest);
  },
  continueSession(manifest: FormManifest) {
    session = acceptManifestInSession(requireSession(), manifest);
    return session;
  },
  currentSessionPage() {
    return currentSessionPage(requireSession());
  },
  normalizeSessionRequest(request: FillRequest, manifest: FormManifest) {
    return normalizeSessionFillRequest(request, requireSession(), manifest);
  },
  sessionGptPacket(manifest: FormManifest) {
    const current = currentSessionPage(requireSession());
    if (!current) throw new Error("E2E harness: no current session page");
    return makeGptPacket(manifest, { sessionId: requireSession().id, pageNumber: current.pageNumber });
  },
};

Object.defineProperty(window, "__formfillE2E", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: api,
});
