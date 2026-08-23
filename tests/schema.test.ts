import { describe, expect, it } from "vitest";
import { parseFillRequest } from "../src/shared/schema";

describe("GPT JSON parser", () => {
  it("extracts JSON from markdown fences", () => {
    const result = parseFillRequest(`
Ответ:
\`\`\`json
{"version":1,"pageFingerprint":"abc","fields":{"F01":"Иванов","F02":true}}
\`\`\`
`);
    expect(result.fields.F01).toBe("Иванов");
    expect(result.fields.F02).toBe(true);
  });

  it("ignores unrelated outer text", () => {
    const result = parseFillRequest('Текст до {"version":1,"fields":{"F01":12}} текст после');
    expect(result.fields.F01).toBe(12);
  });

  it("rejects selectors instead of Fxx IDs", () => {
    expect(() =>
      parseFillRequest('{"version":1,"fields":{"#app input":"Иванов"}}'),
    ).toThrow();
  });

  it("strips a submit field outside the schema", () => {
    const result = parseFillRequest('{"version":1,"submit":true,"fields":{"F01":"Иванов"}}');
    expect("submit" in result).toBe(false);
  });
});
