export function ownerWindow(element: Element): (Window & typeof globalThis) | null {
  return element.ownerDocument.defaultView as (Window & typeof globalThis) | null;
}

export function isInput(element: Element): element is HTMLInputElement {
  const view = ownerWindow(element);
  return Boolean(view && element instanceof view.HTMLInputElement);
}

export function isTextArea(element: Element): element is HTMLTextAreaElement {
  const view = ownerWindow(element);
  return Boolean(view && element instanceof view.HTMLTextAreaElement);
}

export function isSelect(element: Element): element is HTMLSelectElement {
  const view = ownerWindow(element);
  return Boolean(view && element instanceof view.HTMLSelectElement);
}

export function isIframe(element: Element): element is HTMLIFrameElement {
  const view = ownerWindow(element);
  return Boolean(view && element instanceof view.HTMLIFrameElement);
}

export function eventFor(element: Element, type: string, init: EventInit = {}): Event {
  const EventCtor = ownerWindow(element)?.Event ?? Event;
  return new EventCtor(type, init);
}

export function mouseEventFor(element: Element, type: string, init: MouseEventInit = {}): MouseEvent {
  const MouseEventCtor = ownerWindow(element)?.MouseEvent ?? MouseEvent;
  return new MouseEventCtor(type, init);
}

export function keyboardEventFor(element: Element, type: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const KeyboardEventCtor = ownerWindow(element)?.KeyboardEvent ?? KeyboardEvent;
  return new KeyboardEventCtor(type, init);
}

export function framePathFor(element: Element): string {
  const parts: string[] = [];
  let view = ownerWindow(element);

  while (view && view !== view.parent) {
    let frame: Element | null = null;
    try {
      frame = view.frameElement;
    } catch {
      break;
    }
    if (!frame) break;

    const siblings = Array.from(frame.ownerDocument.querySelectorAll("iframe, frame"));
    const index = siblings.indexOf(frame);
    parts.unshift(`frame[${index >= 0 ? index + 1 : "?"}]`);
    view = frame.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  }

  return parts.join(">");
}
