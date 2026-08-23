# Security policy

FormFill Assistant is designed around a deliberately narrow trust boundary: AI may propose **data**, but it does not receive a generic browser-control API.

## Security invariants

The project treats the following as release-blocking invariants:

- no automatic Submit, Next, navigation or arbitrary click actions;
- no CSS/XPath selector execution from AI JSON;
- no JavaScript execution from AI output;
- unknown `Fxx` IDs never redirect writes to another field;
- `pageFingerprint` mismatch blocks a stale response;
- password, OTP, CVV, token-like and other protected fields are not fill targets;
- ambiguous select/combobox matches remain in review;
- preview is mandatory before fill in the user flow;
- the extension has no backend, telemetry or analytics;
- current form values are excluded from the AI manifest;
- screenshot capture uses temporary privacy masks over visible editable controls.

These invariants are covered by unit tests and Firefox E2E tests where practical.

## AI and prompt-injection model

Form labels, option text, visible page content and `[FORM_MANIFEST]` values are treated as **untrusted page data**, not instructions. The generated AI prompt explicitly tells the model to ignore commands embedded in the form such as “ignore previous instructions”.

The manifest remains the authoritative source for allowed field IDs, types and enumerated options.

## Screenshot privacy

Before the built-in screenshot flow captures the visible tab area, editable controls are covered by temporary local overlays. DOM values are not modified. The overlays are removed immediately after capture and have a failure-safe automatic cleanup timer.

Cross-origin iframe content cannot be inspected or reliably masked because of browser origin isolation. The UI warns the user whenever such frames are detected.

## Permissions

The extension intentionally avoids broad persistent host permissions. `activeTab` and `scripting` are used on demand. Firefox 126+ is required so screenshot capture can work through `activeTab` without requesting `<all_urls>`.

## Signed releases

Production Firefox releases require Mozilla AMO signing. The release workflow is configured to fail if AMO credentials are missing rather than publish an unsigned XPI as a successful production release.

See [`docs/FIREFOX_SIGNING.md`](docs/FIREFOX_SIGNING.md).

## Reporting a vulnerability

Do not publish exploitable details in a public issue if the problem could expose user data or allow unintended browser actions. Contact the repository owner privately through GitHub first, with:

- affected version/commit;
- reproduction steps;
- expected vs actual behavior;
- whether arbitrary DOM writes, sensitive-field access, navigation or data disclosure are possible.

Once the issue is understood and patched, a public advisory can document the root cause and fixed version.
