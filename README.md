# Firefox FormFill Assistant

Firefox WebExtension для заполнения произвольных веб-форм по JSON, подготовленному ChatGPT. Расширение само сканирует DOM, присваивает полям временные `Fxx`, формирует безопасный manifest, показывает preview и только после подтверждения записывает значения в элементы страницы.

## Что реализовано в v0.2.0

- Firefox Manifest V3 и штатная боковая панель;
- on-demand инъекция content script через `activeTab` + `scripting`;
- поиск видимых `input`, `textarea`, `select`, contenteditable и основных ARIA controls;
- Fxx ID со стабильностью в рамках сессии и fallback по fingerprint;
- same-origin iframe и open Shadow DOM scanner;
- отслеживание SPA `pushState` / `replaceState` / `popstate` / `hashchange` с `PAGE_CHANGED`;
- MutationObserver для top document, same-origin iframe и open ShadowRoot без polling;
- overlay с Fxx без изменения layout страницы;
- жёлтая/красная overlay-подсветка полей `review/error` без изменения CSS сайта;
- manifest + `pageFingerprint`;
- безопасный пакет `Скопировать для GPT` без текущих значений формы;
- распознавание JSON даже внутри Markdown fences/окружающего текста;
- строгая схема: только `Fxx`/`I#-Fxx`, selectors отклоняются;
- обязательный preview с `ok / review / error / same / skip`;
- input/textarea/date/select/checkbox/radio/contenteditable;
- динамический `role=combobox` с ожиданием списка через MutationObserver;
- native setters + `input/change/focus/blur` для controlled inputs;
- пороги fuzzy matching: auto ≥ 0.95, review 0.75–0.95, error < 0.75;
- значения в review-band автоматически не записываются;
- проверка фактического значения после записи;
- Undo последней операции;
- локальная история последних 10 операций без сохранения значений;
- итоговый privacy-safe отчёт для повторной отправки в ChatGPT;
- чувствительные поля блокируются;
- кнопки и submit намеренно не исполняются.

## Быстрый сценарий

1. Откройте страницу с формой.
2. `Alt+Shift+F` — открыть sidebar.
3. `Alt+Shift+A` или `Анализировать`.
4. Сделайте скриншот с Fxx.
5. Нажмите `Скопировать для GPT`, вставьте текст + скриншот + исходные данные в ChatGPT.
6. Скопируйте JSON из ChatGPT.
7. `Alt+Shift+V` или `Вставить ответ`.
8. Проверьте preview.
9. Нажмите `Заполнить` — однозначные значения будут записаны, неоднозначные останутся нетронутыми для проверки.
10. При необходимости нажмите `Подсветить проблемные` или `Скопировать отчёт для GPT`.
11. Самостоятельно проверьте форму и только затем отправляйте её.

Расширение никогда не нажимает Submit.

## Локальная сборка

Требуется Node.js 22+.

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

## CI/CD и скачиваемые артефакты

`.github/workflows/ci.yml` выполняет два последовательных gate:

1. настоящий headless Firefox/Gecko E2E на production `scanner/preview/filler/undo`;
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

- нет backend и OpenAI API;
- расширение не отправляет данные наружу;
- Firefox manifest явно объявляет `data_collection_permissions.required = ["none"]`;
- не запрашивает cookies/webRequest/history/downloads;
- текущие значения полей не включаются в GPT manifest;
- password/OTP/CVV/API token-подобные поля помечаются как защищённые и не заполняются;
- неизвестный `Fxx` никогда не перенаправляется на другое поле;
- pageFingerprint и SPA invalidation защищают от применения JSON к другой версии формы;
- fuzzy match ниже 0.95 не приводит к автоматическому выбору;
- JSON не может инициировать click/submit.

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
- open Shadow DOM.

## Архитектура

```text
Sidebar
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

GPT определяет **что** записать. Расширение определяет **куда и как** это записать в DOM.

## Статус

`v0.2.0` — hardened MVP: Firefox E2E gate, безопасные пороги сопоставления, runtime для SPA/iframe/Shadow DOM, улучшенный sidebar/reporting и воспроизводимый CI/CD release pipeline.
