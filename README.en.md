<p align="center">
  <img src="src/icons/formfill.svg" width="128" alt="FormFill Assistant icon" />
</p>

<h1 align="center">FormFill Assistant</h1>

<p align="center">
  A safety-first Firefox WebExtension for filling complex web forms with vision AI.<br/>
  <strong>Screenshot → strict prompt → JSON → preview → safe fill. Never auto-submit.</strong>
</p>

<p align="center">
  <a href="README.md">Русский</a> ·
  <a href="README.en.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/f2re/firefox-formfill-assist/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/f2re/firefox-formfill-assist/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/f2re/firefox-formfill-assist/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/f2re/firefox-formfill-assist?display_name=tag" /></a>
  <img alt="Firefox 126+" src="https://img.shields.io/badge/Firefox-126%2B-7c4dff" />
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-16a085" />
</p>

---

## The idea

Vision models can understand a form screenshot, but they should not be trusted to directly control the browser DOM. FormFill Assistant separates responsibilities:

- the AI decides **what values belong in the form**;
- the extension deterministically decides **where and how those values are written**;
- every field is addressed through temporary IDs such as `F01`, `I1-F02`, `P2-F03`;
- every response is bound to a `pageFingerprint`;
- preview is mandatory before a write;
- sensitive fields are blocked;
- navigation and submit remain manual.

## Workflow

<p align="center">
  <img src="docs/assets/workflow.svg" alt="FormFill Assistant workflow" width="100%" />
</p>

1. Open the target form.
2. Analyze it in the sidebar; visible controls receive Fxx IDs.
3. Use **Screenshot + prompt**. Current editable values are temporarily covered by privacy masks.
4. Paste the PNG into a vision-capable AI.
5. Copy the dynamic prompt from the extension and paste it into the same chat.
6. The AI returns strict JSON only.
7. Paste JSON back into FormFill Assistant.
8. Review the mandatory preview.
9. Fill safe fields.
10. Review the page and submit manually.

## What is supported

- input / textarea / date / number / email / tel / contenteditable;
- native select, radio, checkbox;
- ARIA combobox/autocomplete controls;
- React/Vue-style controlled inputs via native setters and DOM events;
- same-origin iframes (`I<n>-Fxx`);
- open Shadow DOM;
- SPA route invalidation;
- dynamic forms through MutationObserver;
- explicit multi-page sessions (`P1-Fxx`, `P2-Fxx`, `P1-I1-F02`);
- confidence-based select/combobox matching;
- undo and privacy-safe operation history.

## Safety model

FormFill Assistant intentionally does **not** provide a generic browser-agent API.

- No backend.
- No telemetry or analytics.
- No hidden upload of form data.
- No submit/click/navigation operation in the JSON contract.
- Password, OTP, CVV and token-like controls are blocked.
- Unknown field IDs are never redirected to another field.
- A page fingerprint mismatch stops the flow.
- Ambiguous values stay in review instead of being auto-filled.
- Prompt injection inside labels/options is treated as untrusted page data.

See [`SECURITY.md`](SECURITY.md) for the threat model.

## Install

Get the latest build from [GitHub Releases](https://github.com/f2re/firefox-formfill-assist/releases/latest).

A normal Firefox installation requires a Mozilla-signed XPI. The release pipeline supports AMO unlisted signing. Repository maintainers must configure:

```text
WEB_EXT_API_KEY     = AMO JWT issuer
WEB_EXT_API_SECRET  = AMO JWT secret
```

See [`docs/FIREFOX_SIGNING.md`](docs/FIREFOX_SIGNING.md).

For development, load `dist/manifest.json` through `about:debugging#/runtime/this-firefox`.

## AI JSON contract

```json
{
  "version": 1,
  "pageFingerprint": "fp-current-page",
  "fields": {
    "F01": "Jane Doe",
    "F02": {
      "action": "select",
      "value": "London"
    },
    "F03": {
      "action": "check"
    }
  }
}
```

Unknown values must be omitted. Do not use `null`, an empty string, `false`, or `0` as a substitute for missing information.

The canonical portable AI prompt is kept in the primary [`README.md`](README.md) and can also be copied directly from the extension UI. A unit test keeps the documented prompt byte-for-byte synchronized with the runtime template.

## Development

Requirements: Node.js 22+ and Firefox 126+.

```bash
npm ci
npm run check
npm run build
npm run lint:extension
npm run package
```

Firefox E2E:

```bash
npx playwright install firefox
npm run test:e2e
```

## Release pipeline

The release workflow runs:

1. Firefox E2E safety matrix;
2. version check, TypeScript and unit tests;
3. Vite build;
4. Mozilla `web-ext lint`;
5. deterministic packaging verification;
6. required AMO signing for production releases;
7. immutable Git tag and GitHub Release creation.

Unsigned artifacts remain useful for development, but production release publication is configured to fail if AMO credentials are unavailable.

## Documentation

- [`README.md`](README.md) — Russian / primary documentation;
- [`README.zh-CN.md`](README.zh-CN.md) — Simplified Chinese;
- [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) — screenshot and prompt handoff;
- [`docs/FIREFOX_SIGNING.md`](docs/FIREFOX_SIGNING.md) — Firefox signing;
- [`SECURITY.md`](SECURITY.md) — security model;
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development and contributions.

---

<p align="center"><strong>AI decides what to fill. FormFill Assistant decides where and how.</strong></p>
