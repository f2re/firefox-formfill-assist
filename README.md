# Firefox FormFill Assistant

Firefox WebExtension для заполнения произвольных веб-форм по JSON, подготовленному ChatGPT. Расширение само сканирует DOM, присваивает полям временные `Fxx`, формирует безопасный manifest, показывает preview и только после подтверждения записывает значения в элементы страницы.

## Что уже реализовано в MVP

- Firefox Manifest V3 и штатная боковая панель;
- on-demand инъекция content script через `activeTab` + `scripting`;
- поиск видимых `input`, `textarea`, `select`, contenteditable и основных ARIA controls;
- Fxx ID со стабильностью в рамках сессии и fallback по fingerprint;
- same-origin iframe и open Shadow DOM scanner;
- overlay с Fxx без изменения layout страницы;
- manifest + `pageFingerprint`;
- безопасный пакет `Скопировать для GPT` без текущих значений формы;
- распознавание JSON даже внутри Markdown fences/окружающего текста;
- строгая схема: только `Fxx`/`I#-Fxx`, selectors отклоняются;
- обязательный preview с `ok / review / error / same / skip`;
- input/textarea/date/select/checkbox/radio/contenteditable;
- базовый динамический `role=combobox`;
- native setters + `input/change/focus/blur` для controlled inputs;
- пороги fuzzy matching: auto ≥ 0.95, review 0.75–0.95, error < 0.75;
- проверка фактического значения после записи;
- Undo последней операции;
- MutationObserver с debounce;
- локальная история последних 10 операций без сохранения значений;
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
9. Нажмите `Заполнить`.
10. Самостоятельно проверьте форму и только затем отправляйте её.

Расширение никогда не нажимает Submit.

## Локальная сборка

Требуется Node.js 22+.

```bash
npm install
npm run check
npm run build
npm run lint:extension
npm run package
```

Результат:

```text
dist/       распакованное расширение
artifacts/  ZIP и unsigned XPI
```

Для разработки откройте `about:debugging#/runtime/this-firefox` → `Load Temporary Add-on` → выберите `dist/manifest.json`.

## CI/CD и скачиваемые артефакты

`.github/workflows/ci.yml` запускается на push/PR, выполняет typecheck/tests, собирает расширение, запускает Mozilla `web-ext lint` и публикует ZIP + unsigned XPI как GitHub Actions artifact.

`.github/workflows/release.yml` запускается по тегу `v*` или вручную. По тегу он создаёт GitHub Release и прикладывает сборки.

### Постоянно устанавливаемый XPI для обычного Firefox

Обычный Firefox требует подпись расширения. Для автоматической AMO-подписи добавьте repository secrets:

- `WEB_EXT_API_KEY` — AMO API key / JWT issuer;
- `WEB_EXT_API_SECRET` — AMO API secret.

После этого release workflow выполняет:

```bash
web-ext sign --channel unlisted
```

и прикладывает подписанный XPI в `signed/`. Без этих secrets CI всё равно создаёт unsigned XPI для `about:debugging`, Developer Edition/Nightly и тестирования.

## Безопасность

- нет backend и OpenAI API;
- расширение не отправляет данные наружу;
- не запрашивает cookies/webRequest/history/downloads;
- текущие значения полей не включаются в GPT manifest;
- password/OTP/CVV/API token-подобные поля помечаются как защищённые и не заполняются;
- неизвестный `Fxx` никогда не перенаправляется на другое поле;
- pageFingerprint блокирует применение JSON к другой версии формы;
- JSON не может инициировать click/submit.

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
   ├─ overlay
   ├─ preview / matcher
   ├─ filler / native events / undo
   └─ MutationObserver
   ▼
DOM
```

GPT определяет **что** записать. Расширение определяет **куда и как** это записать в DOM.

## Статус

Версия `0.1.0` — первый вертикальный MVP. Следующие work packages заведены отдельными GitHub issues: расширенная поддержка UI-framework combobox, e2e matrix, iframe/Shadow DOM hardening, улучшение UX/диагностики.
