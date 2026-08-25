import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makePortableAiPromptTemplate } from "../src/shared/gpt";

const START = "<!-- FORM_FILL_AI_PROMPT:START -->";
const END = "<!-- FORM_FILL_AI_PROMPT:END -->";

function readmePrompt(): string {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0 || end <= start) throw new Error("README AI prompt markers are missing or malformed.");

  const block = readme.slice(start + START.length, end).trim();
  const match = /^```text\n([\s\S]*?)\n```$/.exec(block);
  if (!match?.[1]) throw new Error("README AI prompt must be a single fenced text block.");
  return match[1];
}

describe("README AI prompt contract", () => {
  it("is byte-for-byte synchronized with the portable runtime template", () => {
    expect(readmePrompt()).toBe(makePortableAiPromptTemplate());
  });

  it("documents screenshot binding and the three safe outcomes", () => {
    const prompt = makePortableAiPromptTemplate();
    expect(prompt).toContain("контракт ответа v2");
    expect(prompt).toContain("<CAPTURE_ID_ИЗ_РАСШИРЕНИЯ>");
    expect(prompt).toContain("<СКОПИРУЙ_ТОЧНО_ИЗ_FORM_MANIFEST>");
    expect(prompt).toContain('"version":2');
    expect(prompt).toContain('"status":"ready"');
    expect(prompt).toContain("needs_input");
    expect(prompt).toContain("mismatch");
    expect(prompt).toContain("P<n>-I<n>-Fxx");
    expect(prompt).toContain("Верни только JSON");
    expect(prompt).toContain("JSON.parse");
  });
});
