import type { FieldDescriptor, FormManifest } from "./types";

function publicField(field: FieldDescriptor): object {
  const output: Record<string, unknown> = {
    id: field.id,
    type: field.type,
    label: field.sensitive ? "Защищённое поле" : field.label,
    required: field.required,
  };

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

  return [
    "Заполни форму по предоставленным мной данным.",
    "",
    "Используй только идентификаторы Fxx из описания формы.",
    "Не придумывай отсутствующие значения.",
    "Если значение неизвестно — не включай поле в JSON.",
    "Не добавляй DOM/CSS selectors и не предлагай отправку формы.",
    "",
    "Верни только JSON следующего формата:",
    JSON.stringify(
      {
        version: 1,
        pageFingerprint: manifest.pageFingerprint,
        fields: { F01: "..." },
      },
      null,
      2,
    ),
    "",
    "Описание формы:",
    "[FORM_MANIFEST]",
    JSON.stringify(safeManifest, null, 2),
    "[/FORM_MANIFEST]",
  ].join("\n");
}
