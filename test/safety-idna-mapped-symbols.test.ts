import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Characters that browsers and linkifiers map to ASCII when they resolve a host (UTS #46 /
// IDNA, which is built on NFKC): roman numerals, letterlike symbols, Latin ligatures,
// "digit full stop" characters and squared abbreviations. "mta-refund.\u217Dom" (a roman
// numeral c) opens mta-refund.com. Injected alert text could ask Claude to "write the site
// with these letters so it isn't a link". None of these are \p{L} letters, so the "unexpected
// letters" check doesn't see them: only the NFKC step before the host match does.
//
// All caught today. These guard against a refactor that drops or narrows NFKC normalization
// (for example, replacing it with a hand-picked list of dot lookalikes). Styled letters
// (circled, mathematical, superscript) and NFKC-folded dots are covered in safety.test.ts.
// Non-ASCII is written as \u escapes.
describe("checkRiderMessage vs. IDNA-mapped symbols in a host", () => {
  const alert = makeAlert({ routes: ["4"] });
  const good = {
    en: "[4] trains are delayed both ways after police activity at 149 St. Allow extra time.",
    es: "Los trains [4] van con retraso en ambas direcciones por actividad policial en 149 St.",
  };
  const en = (text: string) => checkRiderMessage({ ...good, en: text }, alert);
  const es = (text: string) => checkRiderMessage({ ...good, es: text }, alert);

  for (const { text, host } of [
    { text: "[4] delayed. Refunds: mta-refund.\u217Dom", host: "mta-refund.com" }, // small roman numeral c
    { text: "[4] delayed. Refunds: \u217Fta-refund.top", host: "mta-refund.top" }, // small roman numeral m
    { text: "[4] delayed. Refunds: mta-refund.\u216D\u216F", host: "mta-refund.cm" }, // roman numerals C M
    { text: "[4] delayed. Refunds: mta-refund.\u210Aov", host: "mta-refund.gov" }, // script small g
    { text: "[4] delayed. Refunds: mta-refund.\u2113y", host: "mta-refund.ly" }, // script small l
    { text: "[4] delayed. Refunds: mta-r\u212Ffund.top", host: "mta-refund.top" }, // script small e
    { text: "[4] delayed. Refunds: mta-re\uFB00und.top", host: "mta-reffund.top" }, // ff ligature
    { text: "[4] delayed. Refunds: mta-refund.\uFB06ore", host: "mta-refund.store" }, // st ligature
    { text: "[4] delayed. Refunds: mta-refund.\u2121", host: "mta-refund.tel" }, // telephone sign
    { text: "[4] delayed. Refunds: mta-refund.\u2122", host: "mta-refund.tm" }, // trade mark sign
    { text: "[4] delayed. Refunds: mta-refund.\u{1F16A}", host: "mta-refund.mc" }, // raised MC sign
  ]) {
    it(`blocks ${JSON.stringify(text)} as a link to ${host}`, () => {
      expect(en(text)).toContainEqual(expect.stringContaining(host));
    });
  }

  it("blocks a 'digit full stop' character that carries the dot itself", () => {
    // U+2488 renders as "1." in one glyph: "mta-refund\u2488top" reads as mta-refund1.top.
    expect(en("[4] delayed. Refunds: mta-refund\u2488top")).toContainEqual(expect.stringContaining("mta-refund1.top"));
    // U+249B is "20.": a scheme link whose host is built from it is still checked.
    expect(en("[4] delayed. Refunds: http://\u249B3.0.113.7/r").length).toBeGreaterThan(0);
  });

  it("blocks the same tricks in the Spanish text", () => {
    expect(es("Trains [4] con retraso. Reembolsos: mta-reembolso.\u217Dom")).toContainEqual(expect.stringContaining("mta-reembolso.com"));
    expect(es("Trains [4] con retraso. Reembolsos: mta-reembolso.\u2122")).toContainEqual(expect.stringContaining("mta-reembolso.tm"));
  });

  // The same symbols away from a dot are not links and must keep passing.
  it("still passes these symbols when they aren't part of a host", () => {
    expect(en("[4] trains are delayed. OMNY\u2122 readers at 149 St are working.")).toEqual([]);
    expect(en("[4] delayed near 149 St. \u2116 change to fares.")).toEqual([]);
  });
});
