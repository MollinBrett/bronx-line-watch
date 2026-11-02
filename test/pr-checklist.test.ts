import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkChecklist } from "../scripts/pr-checklist.mjs";

const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
const tickAll = (body: string) => body.replace(/- \[ \]/g, "- [x]");
const markNA = (body: string, label: string) =>
  body.replace(new RegExp(`(\\*\\*${label.replace(/[()]/g, "\\$&")}:\\*\\*)`), "$1 N/A: not touched.");

describe("PR checklist", () => {
  it("fails the untouched template: unticked boxes are ambiguous", () => {
    expect(checkChecklist(template, []).length).toBe(6);
  });

  it("passes when every box is ticked", () => {
    expect(checkChecklist(tickAll(template), ["src/main.ts"])).toEqual([]);
  });

  it("allows N/A for an area the PR doesn't touch", () => {
    expect(checkChecklist(markNA(tickAll(template), "Dependencies"), ["test/safety.test.ts"])).toEqual([]);
  });

  it("rejects N/A for an area the PR does touch", () => {
    const problems = checkChecklist(markNA(tickAll(template), "Dependencies"), ["package-lock.json"]);
    expect(problems).toEqual([expect.stringContaining("package-lock.json")]);
  });

  it("rejects N/A on agents when agent files change", () => {
    const problems = checkChecklist(markNA(tickAll(template), "Agents"), ["agents/maintainer/agent.md"]);
    expect(problems).toHaveLength(1);
  });

  it("reports a missing item and an empty description", () => {
    expect(checkChecklist(tickAll(template).replace(/.*\*\*Agents.*\n/, ""), [])).toEqual([
      expect.stringContaining('"Agents" is missing'),
    ]);
    expect(checkChecklist(undefined, []).length).toBe(6);
  });

  it("ignores checkboxes hidden in HTML comments", () => {
    const sneaky = template + "\n<!-- - [x] **Watcher code (`src/`):** -->";
    expect(checkChecklist(sneaky, []).some((p) => p.includes("Watcher code"))).toBe(true);
  });
});
