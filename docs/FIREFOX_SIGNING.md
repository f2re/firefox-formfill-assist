# Firefox AMO signing in GitHub Actions

FormFill Assistant releases are intended to ship with a Mozilla-signed XPI. The release workflow uses Mozilla `web-ext sign` with the `unlisted` channel, so the signed XPI can be distributed from GitHub Releases without publishing the extension as a public AMO listing.

## 1. Create AMO API credentials

1. Sign in to the Mozilla Add-ons Developer Hub: https://addons.mozilla.org/developers/
2. Open the API key page: https://addons.mozilla.org/developers/addon/api/key/
3. Generate API credentials.
4. Copy both values immediately:
   - **JWT issuer** → GitHub secret `WEB_EXT_API_KEY`
   - **JWT secret** → GitHub secret `WEB_EXT_API_SECRET`

Do not commit either value to the repository, workflow YAML, issues, logs, or documentation.

The extension already has a stable Firefox add-on ID in `src/manifest.json`:

```text
firefox-formfill-assist@f2re.github
```

Manifest V3 signing requires a stable extension ID; updates must keep this ID unchanged.

## 2. Add GitHub Actions repository secrets

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Create exactly these two repository secrets:

```text
WEB_EXT_API_KEY=<AMO JWT issuer>
WEB_EXT_API_SECRET=<AMO JWT secret>
```

The release workflow reads the standard environment variables supported by `web-ext`.

## 3. What the release workflow does

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
8. SHA-256 generation for the signed XPI.
9. Immutable tag verification/creation.
10. Upload of unsigned developer artifacts plus the signed XPI to GitHub Actions and GitHub Release.

If either AMO secret is missing, the release fails before publication. A successful release can no longer silently contain only an unsigned XPI.

## 4. Sign the existing v0.3.1 release

After the two repository secrets are configured, run **Actions → Release / Firefox → Run workflow** on `main`.

The current pipeline may safely reuse the immutable `v0.3.1` tag when `main` differs from that tag only in release automation/documentation. It does not move or rewrite the tag. It rebuilds the same extension payload, submits it to AMO for unlisted signing, and uploads the returned signed XPI to the existing GitHub Release.

Alternatively, creating an issue with the exact title below triggers the same gated workflow:

```text
[release] v0.3.1
```

Close the trigger issue after a successful release.

## 5. Result

A successful GitHub Release should contain at least:

```text
formfill_assistant-0.3.1.zip
firefox-formfill-assist-0.3.1-unsigned.xpi
SHA256SUMS
<mozilla-returned-name>.xpi          # signed, installable in normal Firefox
signed/SHA256SUMS or signed checksum artifact
```

The Mozilla-returned signed XPI is the file intended for normal persistent installation in release Firefox. The `-unsigned.xpi` remains a developer/debug artifact.
