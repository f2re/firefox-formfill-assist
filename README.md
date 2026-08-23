# Firefox FormFill Assistant

Firefox WebExtension для безопасного заполнения произвольных веб-форм по JSON, подготовленному vision-ИИ. Расширение сканирует DOM, присваивает полям временные `Fxx`, формирует безопасный manifest, умеет подготовить PNG-снимок с промптом для ИИ, показывает preview и только после проверки записывает значения в элементы страницы.

## Что реализовано

- Firefox Manifest V3 и штатная боковая панель;
- on-demand инъекция content script через `activeTab` + `scripting`;
- поиск видимых `input`, `textarea`, `select`, contenteditable и основных ARIA controls;
- Fxx ID со стабильностью в рамках страницы и fallback по fingerprint;
- same-origin iframe и open Shadow DOM scanner;
- отслеживание SPA `pushState` / `replaceState` / `popstate` / `hashchange` с `PAGE_CHANGED`;
- MutationObserver для top document, same-origin iframe и open ShadowRoot без polling;
- overlay с Fxx без изменения layout страницы;
- жёлтая/красная overlay-подсветка полей `review/error` без изменения CSS сайта;
- manifest + `pageFingerprint`;
- мультимодальный schema-strict промпт без текущих значений формы;
- встроенный `Снимок + промпт` для ChatGPT / Claude / Gemini и других vision-моделей;
- временные privacy-маски поверх видимых редактируемых значений на время снимка;
- копирование PNG в системный clipboard и fallback `Скачать PNG`;
- многостраничные локальные сессии с `P1-Fxx`, `P2-Fxx` без автоматической навигации;
- распознавание JSON даже внутри Markdown fences/окружающего текста;
- строгая схема допустимых идентификаторов, selectors отклоняются;
- обязательный preview с `ok / review / error / same / skip`;
- input/textarea/date/select/checkbox/radio/contenteditable;
- динамический `role=combobox` с ожиданием списка через MutationObserver;
- native setters + `input/change/focus/blur` для controlled inputs;
- пороги fuzzy matching: auto ≥ 0.95, review 0.75–0.95, error < 0.75;
- значения в review-band автоматически не записываются;
- проверка фактического значения после записи;
- Undo последней операции;
- локальная история последних 10 операций без сохранения значений;
- privacy-safe отчёт для повторной отправки в ИИ;
- чувствительные поля блокируются;
- кнопки и submit намеренно не исполняются.

## Быстрый сценарий

1. Откройте страницу с формой.
2. `Alt+Shift+F` — открыть sidebar.
3. Нажмите плавающую кнопку `Снимок + промпт`.
4. Нажмите `Подготовить снимок и промпт` — расширение само анализирует форму, показывает Fxx/Pn-Fxx, временно закрывает значения полей и снимает видимую область вкладки.
5. PNG автоматически копируется в clipboard, если Firefox разрешил операцию. Вставьте его в vision-ИИ; при необходимости используйте `Скачать PNG`.
6. Нажмите `Скопировать промпт` и вставьте его в тот же диалог ИИ вместе с исходными данными, из которых должна быть заполнена форма.
7. Скопируйте JSON из ответа ИИ.
8. Вернитесь к форме и нажмите `Alt+Shift+V` или `Вставить ответ`.
9. Проверьте preview.
10. Нажмите `Заполнить` — только однозначные значения будут записаны, неоднозначные останутся нетронутыми для проверки.
11. При необходимости нажмите `Подсветить проблемные` или скопируйте privacy-safe отчёт для ИИ.
12. Самостоятельно проверьте форму и только затем отправляйте её.

Расширение никогда не нажимает Submit или Next.

### Многостраничные анкеты

После анализа первой страницы можно нажать `Начать сессию`. Текущие поля экспортируются как `P1-Fxx`. После ручного перехода на следующую страницу расширение обнаруживает смену формы и предлагает явно подтвердить `Продолжить текущую сессию`; только после подтверждения новая страница получает namespace `P2-Fxx`.

Автоматический переход между страницами намеренно запрещён.

## Локальная сборка

Требуется Node.js 22+ и Firefox 126+.

Firefox 126 выбран как минимум для безопасного `tabs.captureVisibleTab()` через ограниченный `activeTab`: старые Firefox требовали для этого постоянное разрешение `<all_urls>`, которого проект намеренно не запрашивает.

```bash
npm ci
npm run check
npm run build
npm run lint:extension
npm run package
```

Результат:

```text
dist/       распакованное расширение
artifacts/  ZIP, unsigned XPI и SHA256SUMS
```

`package-lock.json` хранится в репозитории, поэтому CI и локальная чистая сборка используют один dependency graph.

Для разработки откройте `about:debugging#/runtime/this-firefox` → `Load Temporary Add-on` → выберите `dist/manifest.json`.

Подробности screenshot handoff: `docs/AI_HANDOFF.md`.

## CI/CD и скачиваемые артефакты

`.github/workflows/ci.yml` выполняет два последовательных gate:

1. настоящий headless Firefox/Gecko E2E на production `scanner/preview/filler/undo/session`;
2. `npm ci` → version check → TypeScript/unit tests → Vite build → Mozilla `web-ext lint` → packaging.

Build job зависит от Firefox E2E, поэтому ZIP/XPI не публикуются при браузерной регрессии.

Упаковщик создаёт детерминированный ZIP/XPI: список файлов сортируется, ZIP metadata фиксируется, после чего CI запускает упаковку второй раз и сравнивает `SHA256SUMS` byte-for-byte. В artifact входят:

```text
formfill_assistant-X.Y.Z.zip
firefox-formfill-assist-X.Y.Z-unsigned.xpi
SHA256SUMS
```

`.github/workflows/release.yml` запускается по тегу `v*` или вручную. Tag release проходит тот же Firefox E2E, проверяет, что тег точно соответствует версии `vX.Y.Z`, затем создаёт GitHub Release.

### Постоянно устанавливаемый XPI для обычного Firefox

Обычный Firefox требует подпись расширения. Для автоматической AMO-подписи добавьте repository secrets:

- `WEB_EXT_API_KEY` — AMO API key / JWT issuer;
- `WEB_EXT_API_SECRET` — AMO API secret.

После этого release workflow выполняет:

```bash
web-ext sign --channel unlisted
```

и прикладывает подписанный XPI и отдельный `signed/SHA256SUMS`. Без этих secrets workflow создаёт проверенный unsigned XPI для `about:debugging` и разработки, но он не считается постоянно устанавливаемым релизом обычного Firefox.

## Безопасность и приватность

- нет backend и встроенного OpenAI/Anthropic/Google API;
- расширение не отправляет данные наружу;
- Firefox manifest явно объявляет `data_collection_permissions.required = ["none"]`;
- не запрашивает cookies/webRequest/history/downloads;
- текущие значения полей не включаются в AI manifest;
- перед встроенным screenshot текущие значения видимых editable controls временно закрываются privacy-масками;
- маски снимаются сразу после capture и дополнительно имеют аварийное самоудаление через 15 секунд;
- cross-origin iframe не обходятся: их содержимое нельзя гарантированно замаскировать, поэтому UI показывает предупреждение;
- password/OTP/CVV/API token-подобные поля помечаются как защищённые и не заполняются;
- неизвестный Fxx никогда не перенаправляется на другое поле;
- `pageFingerprint`, SPA invalidation и session namespace защищают от применения JSON к другой странице;
- fuzzy match ниже 0.95 не приводит к автоматическому выбору;
- JSON не может инициировать click/submit;
- снимок и промпт пользователь сам передаёт выбранной ИИ-системе.

## Firefox E2E safety matrix

В CI на реальном Gecko проверяются как минимум:

- text/date/select/checkbox/radio и post-fill readback;
- отсутствие submit и submit-button click;
- unknown Fxx;
- pageFingerprint mismatch;
- controlled input events;
- динамически появляющиеся зависимые поля;
- Undo;
- duplicate labels;
- sensitive/password fields;
- same-origin iframe;
- open Shadow DOM;
- явный переход P1 → P2 в многостраничной сессии.

Unit tests дополнительно проверяют AI prompt binding и privacy-mask слой screenshot workflow.

## Архитектура

```text
Sidebar
   ├─ основной flow: JSON → preview → fill
   └─ AI handoff: screenshot → prompt → clipboard
             │
             ├─ tabs.captureVisibleTab
             └─ temporary capture-mask.js
   │ runtime.sendMessage
   ▼
Background
   │ tabs.sendMessage / scripting.executeScript
   ▼
Content script
   ├─ scanner / labels / fingerprint
   ├─ iframe / Shadow DOM / SPA observation
   ├─ overlay / problem highlights
   ├─ preview / matcher
   ├─ filler / native events / undo
   └─ MutationObserver
   ▼
DOM
```

ИИ определяет **что** записать. Расширение детерминированно определяет **куда и как** записать это в DOM.

## Статус

`main` содержит hardened MVP v0.2.0 плюс многостраничные сессии и встроенный screenshot → vision-AI handoff. Следующий релизный тег создаётся отдельно после зелёного CI и финального Firefox smoke-test.
