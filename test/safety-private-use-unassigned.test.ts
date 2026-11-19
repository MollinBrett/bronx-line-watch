import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// #51 covers invisible characters that split a host so no link pattern sees it, while the
// rider still reads "mta-refund.top". Its suggested fix rejects or strips \p{Cf} (format
// characters), and test/safety.test.ts adds \p{Cc} (controls). Three more Unicode categories
// do the same thing and are in neither: Private Use (\p{Co}), unassigned code points and
// noncharacters (\p{Cn}), and lone surrogates (\p{Cs}). Most phones draw them as nothing or
// a thin box; Apple devices draw U+F8FF as the Apple logo. None is a letter, so the
// "unexpected letters" check skips them, and none is a host character, so the link pattern
// stops at them. Rider texts never need any of these.
//
// One rule covers every category #51 and these guards name: reject \p{C} other than "\n".
// Prototyped locally: it turns all #51 guards here and in test/safety.test.ts green (so they
// show up as failing `it.fails`), and every other test still passes.
// Non-ASCII written as \u escapes so this file has no invisible characters itself.

const alert = makeAlert({ routes: ["4"] });
const good = { en: "[4] trains are delayed in both directions.", es: "Los trains [4] van con retrasos." };
const en = (text: string) => checkRiderMessage({ ...good, en: text }, alert);
const es = (text: string) => checkRiderMessage({ ...good, es: text }, alert);
const hex = (ch: string) => "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

const HIDING: [string, string][] = [
  ["private use", "\uE000"],
  ["private use, Apple logo", "\uF8FF"],
  ["supplementary private use", "\u{F0000}"],
  ["noncharacter", "\uFDD0"],
  ["noncharacter", "\uFFFF"],
  ["unassigned", "\u0378"],
  ["unassigned, tag block", "\u{E0080}"],
  ["lone surrogate", "\uD800"],
];

describe("checkRiderMessage vs. private-use, unassigned and surrogate code points", () => {
  for (const [kind, ch] of HIDING) {
    it.fails(`blocks a host split by ${kind} ${hex(ch)} - known gap, #51`, () => {
      expect(en(`[4] delayed. Refunds: mta-refund${ch}.top`).length).toBeGreaterThan(0);
      expect(en(`[4] delayed. Refunds: mta-refund.${ch}top`).length).toBeGreaterThan(0);
    });
  }

  it.fails("blocks a host split by a private-use character in Spanish - known gap, #51", () => {
    expect(es("Los trains [4] van con retrasos. Reembolsos: mta-reembolso\uF8FF.com").length).toBeGreaterThan(0);
  });

  // Regression guards: caught today, because the scheme check still finds "://mta-refund.top".
  it("still blocks a scheme link with one of these characters before the ://", () => {
    for (const [, ch] of HIDING) {
      expect(en(`[4] delayed. Refunds: https${ch}://mta-refund.top`).length, hex(ch)).toBeGreaterThan(0);
    }
  });

  it("still blocks a plain link next to one of these characters", () => {
    for (const [, ch] of HIDING) {
      expect(en(`[4] delayed.${ch} Refunds: mta-refund.top`).length, hex(ch)).toBeGreaterThan(0);
    }
  });

  // Allow cases: the eventual fix must keep line breaks, Spanish letters and punctuation.
  it("passes ordinary texts with line breaks, accents and Spanish punctuation", () => {
    expect(en("[4] trains are delayed.\nAllow extra time.")).toEqual([]);
    expect(es("\u00BFVas en el [4]? Los trains van con retrasos.\n\u00A1Sal con tiempo! Est\u00E1n en la 149.")).toEqual([]);
  });
});
