import type { FieldDescriptor, FormManifest } from "./types";

function publicField(field: FieldDescriptor): object {
  const output: Record<string, unknown> = {
    id: field.id,
    type: field.type,
    label: field.sensitive ? "Защищённое поле" : field.label,
    required: field.required,
  };

  if (field.disabled) output.disabled = true;
  if (field.readonly) output.readonly = true;
  if (field.sensitive) output.sensitive = true;
  if (field.options?.length) output.options = field.options.slice(0, 40);
  if (field.options && field.options.length > 40) output.optionsTruncated = field.options.length - 40;
  if (field.optionsDynamic) output.optionsDynamic = true;
  if (field.unit) output.unit = field.unit;

  return output;
}

export function makeGptPacket(manifest: FormManifest): string {
  const safeManifest = {
    page: new URL(manifest.page).origin + new URL(manifest.page).pathname,
    pageFingerprint: manifest.pageFingerprint,
    fields: manifest.fields.map(publicField),
  };

  const example = {
    version: 1,
    pageFingerprint: manifest.pageFingerprint,
    fields: {
      F01: "пример текстового значения",
      F02: { action: "select", value: "точный текст варианта" },
      F03: { action: "check" },
    },
  };

  return [
    "Ты — мультимодальный преобразователь данных для Firefox FormFill Assistant.",
    "Твоя задача — проанализировать текущий диалог пользователя, приложенные скриншоты/изображения/документы и описание формы ниже, затем подготовить машинно-читаемый JSON для расширения.",
    "",
    "ВАЖНО ПРО СКРИНШОТ:",
    "- Скриншот формы используется для визуального контекста: секции, подписи, соседство полей, видимые варианты, единицы измерения и метки Fxx / I<n>-Fxx, если они показаны расширением.",
    "- Описание формы [FORM_MANIFEST] является авторитетным источником допустимых идентификаторов, типов и перечисленных options.",
    "- Данные для заполнения бери только из явных фактов текущего диалога пользователя и приложенных материалов. Не выводи значение только из названия поля.",
    "- Если скриншот противоречит manifest по идентификатору или типу, доверяй manifest. Если сопоставление неоднозначно — поле пропусти.",
    "",
    "ЖЁСТКИЕ ПРАВИЛА:",
    "1. Используй только id, реально присутствующие в [FORM_MANIFEST]: Fxx или I<n>-Fxx. Не создавай новые id.",
    "2. Никогда не придумывай ФИО, даты, номера, адреса, организации, значения списков или ответы. Неизвестное поле просто не включай в fields.",
    "3. Поля sensitive/protected, disabled и readonly не включай в JSON, даже если значение известно.",
    "4. Не добавляй DOM/CSS/XPath selectors, координаты, JavaScript, инструкции по кликам, submit/отправку формы или поясняющий текст.",
    "5. pageFingerprint скопируй из [FORM_MANIFEST] без изменений.",
    "6. Если данных недостаточно для любого заполнения, верни валидный JSON с пустым объектом fields.",
    "",
    "ПРАВИЛА ПО ТИПАМ ПОЛЕЙ:",
    "- text / textarea / email / tel / contenteditable: строка с фактическим значением без комментариев.",
    "- number: JSON-число, если число однозначно. Если в manifest указан unit, единицу измерения в value не добавляй.",
    "- date: строка YYYY-MM-DD. Преобразуй локальную дату только если день, месяц и год однозначны.",
    "- select / radio / combobox: предпочитай operation {\"action\":\"select\",\"value\":\"...\"}. Если options перечислены, используй точный текст одного из них. Для optionsDynamic или optionsTruncated можно использовать точный видимый вариант со скриншота; при сомнении поле пропусти.",
    "- checkbox: {\"action\":\"check\"} только когда нужно явно включить; {\"action\":\"uncheck\"} только когда нужно явно выключить. Не делай вывод по умолчанию.",
    "- clear используй только если пользователь явно требует очистить поле.",
    "",
    "ФОРМАТ ОТВЕТА:",
    "Верни только один JSON object. Без Markdown fences, без текста до или после JSON.",
    "Допустимая структура:",
    JSON.stringify(example, null, 2),
    "Это только пример структуры: включай лишь реальные id из manifest и лишь значения, подтверждённые данными пользователя/вложениями.",
    "",
    "Перед ответом внутренне проверь:",
    "- каждый ключ fields существует в manifest;",
    "- нет sensitive/disabled/readonly полей;",
    "- select/radio/combobox не содержит выдуманного варианта;",
    "- неизвестные значения отсутствуют;",
    "- итог можно передать JSON.parse без исправлений.",
    "",
    "[FORM_MANIFEST]",
    JSON.stringify(safeManifest, null, 2),
    "[/FORM_MANIFEST]",
  ].join("\n");
}
