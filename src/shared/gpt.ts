import type { FieldDescriptor, FormManifest } from "./types";
import { qualifySessionFieldId } from "./session";

export interface GptSessionContext {
  sessionId: string;
  pageNumber: number;
}

function publicField(field: FieldDescriptor, session?: GptSessionContext): object {
  const output: Record<string, unknown> = {
    id: session ? qualifySessionFieldId(session.pageNumber, field.id) : field.id,
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

export function makeGptPacket(manifest: FormManifest, session?: GptSessionContext): string {
  const idExample = session ? qualifySessionFieldId(session.pageNumber, "F01") : "F01";
  const idDescription = session
    ? `Используй только идентификаторы P${session.pageNumber}-Fxx из описания текущей страницы сессии.`
    : "Используй только идентификаторы Fxx из описания формы.";

  const safeManifest: Record<string, unknown> = {
    page: new URL(manifest.page).origin + new URL(manifest.page).pathname,
    pageFingerprint: manifest.pageFingerprint,
    fields: manifest.fields.map((field) => publicField(field, session)),
  };
  if (session) {
    safeManifest.session = {
      id: session.sessionId,
      page: session.pageNumber,
      fieldPrefix: `P${session.pageNumber}-`,
    };
  }

  return [
    "Заполни форму по предоставленным мной данным.",
    "",
    idDescription,
    session ? "Не используй идентификаторы другой страницы P#-Fxx." : "",
    "Не придумывай отсутствующие значения.",
    "Если значение неизвестно — не включай поле в JSON.",
    "Не добавляй DOM/CSS selectors и не предлагай отправку формы.",
    "",
    "Верни только JSON следующего формата:",
    JSON.stringify(
      {
        version: 1,
        pageFingerprint: manifest.pageFingerprint,
        fields: { [idExample]: "..." },
      },
      null,
      2,
    ),
    "",
    "Описание формы:",
    "[FORM_MANIFEST]",
    JSON.stringify(safeManifest, null, 2),
    "[/FORM_MANIFEST]",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}
