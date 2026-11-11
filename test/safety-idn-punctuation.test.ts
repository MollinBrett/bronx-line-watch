import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Punctuation that IDNA2008 allows inside real domain names (CONTEXTO characters): the Catalan
// middle dot in "l\u00B7l", the Katakana middle dot, the Greek keraia, the Hebrew geresh, and
// Arabic-Indic digits. `HOST` in src/safety.ts doesn't treat these as label characters, so it
// splits a host at them. These tests check that a split never leaves only an allowed MTA tail
// (or nothing) to look at. Non-ASCII is written as \u escapes so this file has no lookalikes.
//
// Not tested on purpose: "x_mta.info", "x\u0375mta.info" and "x\u05F3mta.info" pass today, because
// the split leaves exactly "mta.info". None of them can be registered: registries forbid "_", and
// IDNA2008 needs a Greek letter after the keraia and a Hebrew letter before the geresh, which
// the "unexpected letters" check catches.

const alert = makeAlert({ routes: ["4"] });
const es = "Los trenes [4] van con retrasos en ambas direcciones.";
const blocked = (en: string) => checkRiderMessage({ en, es }, alert);

describe("checkRiderMessage vs. IDN punctuation inside a host", () => {
  // Regression guards: caught today, must stay caught.
  it("blocks a Catalan l\u00B7l host that ends in mta.info", () => {
    expect(blocked("[4] delayed. Refunds: col\u00B7lmta.info")).toContainEqual(expect.stringContaining("lmta.info"));
    expect(blocked("[4] delayed. Refunds: https://col\u00B7lmta.info/r")).toContainEqual(
      expect.stringContaining("xn--collmta-xma.info"),
    );
  });

  it("blocks a host split by a middle dot after the allowed host or mid-label", () => {
    expect(blocked("[4] delayed. new.mta.info\u00B7mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. mta-ref\u00B7lund.top")).toContainEqual(expect.stringContaining("lund.top"));
  });

  it("blocks a Katakana middle dot in front of mta.info", () => {
    expect(blocked("[4] delayed. \u30A2\u30FBmta.info").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. https://\u30A2\u30FBmta.info/r")).toContainEqual(expect.stringContaining("xn--"));
  });

  it("blocks Arabic-Indic digits glued onto mta.info or used as a host", () => {
    expect(blocked("[4] delayed. \u0663\u0664\u0665mta.info").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. \u0663\u0664\u0665.top").length).toBeGreaterThan(0);
  });

  it("blocks an underscore host when it has a scheme", () => {
    expect(blocked("[4] delayed. https://x_mta.info/r")).toContainEqual(expect.stringContaining("x_mta.info"));
  });

  // Allow cases: these must not cause false positives.
  it("still passes a middle dot in an ordinary word, and a plain MTA link", () => {
    expect(blocked("[4] delayed near Col\u00B7legi Av. Details: new.mta.info/alerts")).toEqual([]);
  });

  // Known gap (#51, visible dot lookalikes NFKC doesn't fold): a middle dot reads as a dot.
  it.fails("blocks middle dots used as a visible dot in a domain - known gap, #51", () => {
    for (const dot of ["\u00B7", "\u30FB", "\uFF65"]) {
      expect(blocked(`[4] delayed. Refunds: mta-refund${dot}top`).length).toBeGreaterThan(0);
    }
  });
});
