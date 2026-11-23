import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadState, planAnnouncements, saveState, type State } from "../src/state.js";
import { makeAlert } from "./helpers.js";

// Alert IDs come straight from the MTA feed and are used as keys of a plain object in
// state.ts. Assigning to "__proto__" there is silently dropped, so that alert is never
// remembered and is rewritten and texted on every poll (#96). Each case runs the same
// path as tick(): plan, save to disk, load, plan again.
const dir = mkdtempSync(join(tmpdir(), "blw-state-"));

// Returns how many alerts each tick would announce. The first count matters as much as the
// second: "0 on the second tick" alone can't tell an alert announced once from one never selected.
async function announcedOnTicks(id: string): Promise<{ first: number; second: number }> {
  const alerts = [makeAlert({ id })];
  const file = join(dir, `${encodeURIComponent(id)}.json`);
  const first = planAnnouncements(alerts, { announced: {} });
  await saveState(file, first.next);
  const loaded = (await loadState(file)) as State;
  return { first: first.toAnnounce.length, second: planAnnouncements(alerts, loaded).toAnnounce.length };
}

describe("planAnnouncements vs. alert IDs that are object-property names", () => {
  // Outside it.fails on purpose: a failure here must not be read as the expected failure below.
  it("selects an alert whose id is __proto__ on the first tick", async () => {
    expect((await announcedOnTicks("__proto__")).first).toBe(1);
  });

  it.fails("does not announce an alert whose id is __proto__ again on the next tick - known gap, #96", async () => {
    expect((await announcedOnTicks("__proto__")).second).toBe(0);
  });

  // Regression guards: these already work and must keep working.
  for (const id of ["lmm:alert:12345", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    it(`announces an alert with id ${id} once, not again on the next tick`, async () => {
      expect(await announcedOnTicks(id)).toEqual({ first: 1, second: 0 });
    });
  }

  it("still announces an alert again when its text changes", async () => {
    const first = planAnnouncements([makeAlert({ id: "lmm:alert:1" })], { announced: {} });
    const changed = makeAlert({ id: "lmm:alert:1", header: "[4] trains are suspended." });
    expect(planAnnouncements([changed], first.next).toAnnounce).toHaveLength(1);
  });
});
