import { fillRequest, undoLast } from "../../src/content/filler";
import { previewFill } from "../../src/content/preview";
import { scanDocument, type ScanState } from "../../src/content/scanner";
import type { FillRequest } from "../../src/shared/types";

let state: ScanState | null = null;
let mutationRevision = 0;

function requireState(): ScanState {
  if (!state) throw new Error("E2E harness: scan() must be called first");
  return state;
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
};

Object.defineProperty(window, "__formfillE2E", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: api,
});
