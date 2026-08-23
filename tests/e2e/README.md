# Firefox E2E safety gate

These tests run the production DOM engine (`scanner`, `preview`, `filler`, `undo`) inside a real headless Firefox/Gecko process.

The harness is bundled only for tests and is not shipped in the extension artifact.

Critical invariants covered here include:

- JSON never submits a form or clicks a submit button;
- unknown `Fxx` cannot redirect a write to another control;
- a page fingerprint mismatch is visible before filling;
- controlled inputs receive browser events and are verified by reading actual DOM state;
- sensitive/password controls remain blocked;
- same-origin iframes and open Shadow DOM are scanned;
- Undo restores prior values.

The CI build/package job depends on this Firefox job, so a failing Gecko test prevents downloadable ZIP/XPI artifacts from being produced.
