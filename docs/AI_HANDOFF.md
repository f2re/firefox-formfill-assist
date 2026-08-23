# Screenshot + prompt handoff to vision AI

FormFill Assistant keeps the AI provider outside the extension. The extension does not call OpenAI, Anthropic, Google, or any other external API.

## User flow

1. Open the target form and the FormFill Assistant sidebar.
2. Click **Снимок + промпт**.
3. Click **Подготовить снимок и промпт**.
4. The extension rescans the form, shows the Fxx/Pn-Fxx overlay, temporarily masks the visible values of editable controls, and captures the visible tab area as PNG.
5. The PNG is copied to the system clipboard when Firefox allows it. A **Скачать PNG** fallback is always available.
6. Paste the PNG into a vision-capable AI chat.
7. Click **Скопировать промпт** and paste the prompt into the same chat.
8. Copy the JSON returned by the AI.
9. Return to the form and use **Вставить ответ**. Preview remains mandatory before filling.

## Safety properties

- No screenshot, manifest, or form value is sent over the network by the extension.
- The prompt is bound to the current `pageFingerprint`.
- Active multi-page sessions use the current `Pn-Fxx` namespace.
- The AI may only return field IDs present in the exported manifest.
- Current values of visible editable controls are covered by temporary privacy masks before capture.
- Privacy masks are removed immediately after capture and also self-remove after 15 seconds as a failure-safe.
- Cross-origin iframe contents cannot be reliably masked because of browser origin isolation. The sidebar shows an explicit warning when the scanner reports such frames.
- The extension never clicks Next or Submit.

## Firefox compatibility

Screenshot capture uses `tabs.captureVisibleTab()` with the existing `activeTab` permission. Firefox 126+ is required because Firefox 125 and earlier required the much broader `<all_urls>` permission for this API. The project intentionally chooses the newer minimum version instead of requesting persistent access to all websites.

Image clipboard copying uses Firefox's WebExtension `clipboard.setImageData()` API and the existing `clipboardWrite` permission.
