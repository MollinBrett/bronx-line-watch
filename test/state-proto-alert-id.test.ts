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

async function announcedOnSecondTick(id: string): Promise<number> {
  const alerts = [makeAlert({ id })];
  const file = join(dir, `${encodeURIComponent(id)}.json`);
  const first = planAnnouncements(alerts, { announced: {} });
  await saveState(file, first.next);
  const loaded = (await loadState(file)) as State;
  return planAnnouncements(alerts, loaded).toAnnounce.length;
}

describe("planAnnouncements vs. alert IDs that are object-property names", () => {
  it.fails("remembers an alert whose id is __proto__ - known gap, #96", async () => {
    expect(await announcedOnSecondTick("__proto__")).toBe(0);
  });

  // Regression guards: these already work and must keep working.
  for (const id of ["lmm:alert:12345", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    it(`announces an alert with id ${id} once, not again on the next tick`, async () => {
      expect(await announcedOnSecondTick(id)).toBe(0);
    });
  }

  it("still announces an alert again when its text changes", async () => {
    const first = planAnnouncements([makeAlert({ id: "lmm:alert:1" })], { announced: {} });
    const changed = makeAlert({ id: "lmm:alert:1", header: "[4] trains are suspended." });
    expect(planAnnouncements([changed], first.next).toAnnounce).toHaveLength(1);
  });
});
