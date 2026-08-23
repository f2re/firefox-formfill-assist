# Changelog

All notable user-facing changes to FormFill Assistant are documented here.

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
