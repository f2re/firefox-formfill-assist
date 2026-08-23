# Contributing

Thanks for improving FormFill Assistant. The project favors deterministic browser behavior, narrow permissions and explicit user review over “agentic” convenience.

## Local setup

Requirements:

- Node.js 22+
- Firefox 126+

```bash
npm ci
npm run check
npm run build
npm run lint:extension
npm run package
```

For Firefox E2E:

```bash
npx playwright install firefox
npm run test:e2e
```

## Pull request expectations

A change should normally include:

1. a concise explanation of the user-visible problem;
2. unit or Firefox E2E coverage for behavioral changes;
3. no broadening of permissions without a strong justification;
4. no weakening of preview, fingerprint, sensitive-field or no-submit protections;
5. documentation updates when the user flow or AI contract changes.

## AI prompt contract

The portable prompt shown in `README.md` is synchronized with `makePortableAiPromptTemplate()` by `tests/prompt-doc-sync.test.ts`.

If the runtime AI contract changes, update the documented block between:

```text
<!-- FORM_FILL_AI_PROMPT:START -->
<!-- FORM_FILL_AI_PROMPT:END -->
```

The unit test must remain byte-for-byte green.

## UI changes

Keep the main sidebar flow understandable without documentation:

- analyze the page;
- prepare/copy the AI package;
- paste the JSON response;
- review preview;
- fill safe fields.

Secondary controls belong in details/session/history areas. Avoid adding another “main” action unless it materially shortens the common path.

## Security-sensitive changes

Treat changes to these files as security-sensitive:

- `src/content/filler.ts`
- `src/content/preview.ts`
- `src/shared/schema.ts`
- `src/shared/gpt.ts`
- `src/shared/session.ts`
- screenshot/privacy-mask logic
- `src/manifest.json`
- release/signing workflows

For those changes, explicitly consider unknown IDs, stale fingerprints, prompt injection, sensitive fields, page mutations, iframe identity and accidental button clicks.

## Release process

Production releases must pass:

- Firefox E2E;
- TypeScript and unit tests;
- `web-ext lint`;
- deterministic package verification;
- Mozilla AMO signing;
- immutable tag verification.

See [`docs/FIREFOX_SIGNING.md`](docs/FIREFOX_SIGNING.md).
