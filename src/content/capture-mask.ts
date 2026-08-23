const ROOT_ID = "__formfill_assist_capture_mask__";
const FORMFILL_OVERLAY_ID = "__formfill_assist_overlay__";
const AUTO_CLEANUP_MS = 15_000;

const CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(",");

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
}

function collectControls(root: Document | ShadowRoot): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
  const all = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const element of all) {
    if (element.shadowRoot) found.push(...collectControls(element.shadowRoot));
  }
  return found;
}

function removeMasks(doc: Document): void {
  doc.getElementById(ROOT_ID)?.remove();
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) removeMasks(frame.contentDocument);
    } catch {
      // Cross-origin frames cannot be inspected or masked.
    }
  }
}

function addMasks(doc: Document, createdRoots: HTMLElement[]): void {
  if (!doc.documentElement || doc.getElementById(ROOT_ID)) return;

  const root = doc.createElement("div");
  root.id = ROOT_ID;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483646",
    overflow: "hidden",
  });

  const seen = new Set<HTMLElement>();
  for (const element of collectControls(doc)) {
    if (seen.has(element)) continue;
    seen.add(element);
    if (!element.isConnected || !isVisible(element)) continue;
    if (element.closest(`#${FORMFILL_OVERLAY_ID}, #${ROOT_ID}`)) continue;

    const rect = element.getBoundingClientRect();
    const mask = doc.createElement("div");
    Object.assign(mask.style, {
      position: "fixed",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(2, rect.width)}px`,
      height: `${Math.max(2, rect.height)}px`,
      borderRadius: "4px",
      background: "rgba(248,250,252,.97)",
      boxShadow: "inset 0 0 0 1px rgba(100,116,139,.28)",
      pointerEvents: "none",
    });
    root.append(mask);
  }

  doc.documentElement.append(root);
  createdRoots.push(root);

  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) addMasks(frame.contentDocument, createdRoots);
    } catch {
      // Cross-origin frames remain visible; the sidebar warns the user.
    }
  }
}

const alreadyMasked = Boolean(document.getElementById(ROOT_ID));
if (alreadyMasked) {
  removeMasks(document);
} else {
  const createdRoots: HTMLElement[] = [];
  addMasks(document, createdRoots);
  window.setTimeout(() => {
    for (const root of createdRoots) root.remove();
  }, AUTO_CLEANUP_MS);
}
