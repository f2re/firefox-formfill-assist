# Firefox AMO signing and product metadata in GitHub Actions

FormFill Assistant production releases ship with a Mozilla-signed XPI. The release workflow uses Mozilla `web-ext sign` with the `unlisted` channel, so the signed XPI can be distributed from GitHub Releases without requiring a public AMO listing.

The same AMO credentials are also used to keep the **Developer Hub / AMO product icon** synchronized with the extension branding.

## 1. Create AMO API credentials

1. Sign in to the Mozilla Add-ons Developer Hub: https://addons.mozilla.org/developers/
2. Open the API key page: https://addons.mozilla.org/developers/addon/api/key/
3. Generate API credentials.
4. Copy both values immediately:
   - **JWT issuer** → GitHub secret `WEB_EXT_API_KEY`
   - **JWT secret** → GitHub secret `WEB_EXT_API_SECRET`

Do not commit either value to the repository, workflow YAML, issues, logs, or documentation.

The extension has a stable Firefox add-on ID in `src/manifest.json`:

```text
firefox-formfill-assist@f2re.github
```

Manifest V3 signing and metadata updates must keep this ID unchanged.

## 2. Add GitHub Actions repository secrets

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Create exactly these two repository secrets:

```text
WEB_EXT_API_KEY=<AMO JWT issuer>
WEB_EXT_API_SECRET=<AMO JWT secret>
```

The release workflow reads the standard environment variables supported by `web-ext` and uses the same credentials for authenticated AMO API requests.

## 3. Why AMO can show a green puzzle icon

There are two related but separate icon systems:

1. `manifest.json → icons` controls the extension icon inside Firefox, for example `about:addons`.
2. The AMO/Developer Hub product page stores its own `icon` metadata.

Updating the icon in a later extension package does **not reliably replace an existing AMO product icon**. AMO exposes a dedicated authenticated endpoint for this metadata:

```text
PATCH /api/v5/addons/addon/<guid>/
multipart field: icon=<PNG/JPEG>
```

FormFill Assistant therefore keeps a square 128×128 PNG branding asset and the release workflow uploads it to AMO after signing. The source asset is stored as `src/icons/formfill-128.png.b64`; `npm run build` materializes it as `dist/icons/formfill-128.png`.

## 4. What the release workflow does

A release must pass, in order:

1. Firefox/Gecko E2E safety matrix.
2. Version verification, TypeScript and unit tests.
3. Production build.
4. Mozilla `web-ext lint`.
5. Deterministic ZIP/unsigned-XPI packaging check.
6. Mandatory AMO signing:

```bash
npx web-ext sign \
  --source-dir dist \
  --artifacts-dir signed \
  --channel unlisted \
  --approval-timeout 900000
```

7. Verification that AMO returned exactly one non-empty signed `.xpi`.
8. Stable rename to `firefox-formfill-assist-X.Y.Z-signed.xpi` and SHA-256 generation.
9. Authenticated AMO API upload of the 128×128 product icon.
10. Immutable tag verification/creation.
11. Upload of developer artifacts plus the signed XPI to GitHub Actions and GitHub Release.

If either AMO secret is missing, signing or product metadata synchronization cannot pass and the production release is not published.

## 5. Result

A successful GitHub Release contains at least:

```text
formfill_assistant-X.Y.Z.zip
firefox-formfill-assist-X.Y.Z-unsigned.xpi
SHA256SUMS
firefox-formfill-assist-X.Y.Z-signed.xpi
signed/SHA256SUMS
```

The `-signed.xpi` is intended for normal persistent installation in release Firefox. The `-unsigned.xpi` remains a developer/debug artifact.

AMO image resizing/cache updates are asynchronous, so the Developer Hub icon can take a short time to refresh after the API accepts the new PNG.
