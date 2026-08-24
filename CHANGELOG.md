# Changelog

All notable user-facing changes to FormFill Assistant are documented here.

## 0.4.2

### Critical sidebar reliability

- fixed the blank Firefox sidebar caused by Vite emitting extension-root `/assets/*` URLs instead of paths relative to `sidebar/index.html`;
- production build now fails when any sidebar script, stylesheet, icon or other referenced asset is missing, empty or root-absolute;
- added a real Firefox/Playwright startup smoke test that serves the production `dist/` package, loads `sidebar/index.html`, checks for page errors/404 responses and exercises screenshot preparation;
- added a visible bootstrap fallback so a future JavaScript startup failure produces an actionable message instead of an empty panel.

### Guided UX

- replaced the detached floating screenshot tool with a persistent five-step workflow: page → screenshot → AI response → preview → fill;
- one primary action now scans the page, applies privacy masks, captures the screenshot and prepares the dynamic prompt;
- the AI response can be pasted directly into the guided card or read from the clipboard;
- the simple interface hides sessions, history and manual utilities by default while retaining them behind “Advanced tools”;
- the workflow automatically collapses and scrolls to the mandatory preview after the AI response is submitted for validation.

## 0.4.1

### Branding / AMO

- added a real 128×128 PNG product icon to the built extension alongside the vector toolbar icon;
- `manifest.icons[128]` now references the raster product icon used by Firefox/AMO surfaces;
- release CI authenticates to the AMO v5 API and uploads the same 128×128 PNG to the add-on's separate product-page icon metadata;
- added a regression test for the PNG signature, dimensions and manifest branding contract;
- documented why the AMO Developer Hub can show the default green puzzle icon even when the XPI contains a valid manifest icon.

## 0.4.0

### Product and UX

- new FormFill Assistant brand icon used by the Firefox extension and documentation;
- redesigned sidebar visual system with clearer action hierarchy, light/dark themes and compact responsive layouts;
- redesigned screenshot + prompt handoff panel with an explicit 3-step AI workflow;
- user-facing terminology standardized around AI/ИИ rather than one specific provider;
- extension manifest now exposes project metadata, homepage and icon set.

### Documentation

- rebuilt Russian README as a project landing page;
- added English and Simplified Chinese README editions;
- added branded workflow infographic;
- added `SECURITY.md` and `CONTRIBUTING.md`;
- preserved byte-for-byte synchronization between the portable AI prompt in README and the runtime prompt template.

### Release engineering

- production Firefox releases require Mozilla AMO credentials;
- release pipeline validates Firefox E2E, TypeScript/unit tests, `web-ext lint` and deterministic packaging before the signing gate;
- unsigned XPI can still be produced by CI for development, but cannot be published as a successful production release.

## 0.3.1

- portable AI prompt exposed in the UI;
- README prompt synchronized with runtime through a unit test;
- release pipeline hardened for deterministic packaging and GitHub Release publication.

## 0.3.0

- built-in screenshot + vision-AI handoff;
- temporary privacy masks before screenshot capture;
- multi-page `Pn-Fxx` sessions;
- iframe-aware page/session identities such as `P1-I1-F02`;
- Firefox 126+ minimum to keep screenshot capture on narrow `activeTab` permissions.

## 0.2.0

- hardened MVP with Firefox E2E gates;
- safe field matching, preview, undo and result reporting;
- SPA / iframe / open Shadow DOM runtime support;
- reproducible ZIP/XPI packaging.
