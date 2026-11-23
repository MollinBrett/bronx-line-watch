import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// #23: callback phone numbers aren't blocked yet. A fix that only counts ASCII digits
// (\d in a JS regex, even with the u flag) would still miss a number written in another
// script's digits or as keycap emoji. NFKC doesn't fold Arabic-Indic or Devanagari digits
// to ASCII, they aren't letters (so the "unexpected letters" check ignores them), and phone
// data detectors (libphonenumber) read any Unicode decimal digit as a digit.
// These guards make sure the #23 fix covers them too.
const alert = makeAlert({ routes: ["4"] });
const es = "Los trenes [4] van con retrasos en ambas direcciones.";
const en = "[4] trains are delayed in both directions.";
const blocked = (text: string) => checkRiderMessage({ en: text, es }, alert);
const blockedEs = (text: string) => checkRiderMessage({ en, es: text }, alert);
const keycaps = [..."7185550123"].map((d) => `${d}\uFE0F\u20E3`).join("");

describe("checkRiderMessage vs. phone numbers in non-ASCII digits", () => {
  // Each text has nothing suspicious but the number itself: no "call", "refund", "llama" or
  // "reembolso". A fix that only looks for solicitation words must not turn these green; only
  // a check on the digits can. One test per script and language, so a partial fix shows up.
  it.fails("blocks a bare number in Arabic-Indic digits - known gap, #23", () => {
    expect(blocked("[4] trains are delayed. Info: \u0667\u0661\u0668-\u0665\u0665\u0665-\u0660\u0661\u0662\u0663").length).toBeGreaterThan(0);
  });

  it.fails("blocks a bare number in Devanagari digits - known gap, #23", () => {
    expect(blocked("[4] trains are delayed. Info: \u096D\u0967\u096E \u096B\u096B\u096B \u0966\u0967\u0968\u0969").length).toBeGreaterThan(0);
  });

  it.fails("blocks a bare number in keycap emoji digits - known gap, #23", () => {
    expect(blocked(`[4] trains are delayed. Info: ${keycaps}`).length).toBeGreaterThan(0);
  });

  it.fails("blocks a bare number in Arabic-Indic digits in Spanish - known gap, #23", () => {
    expect(blockedEs("Los trenes [4] van con retrasos. Info: \u0667\u0661\u0668-\u0665\u0665\u0665-\u0660\u0661\u0662\u0663").length).toBeGreaterThan(0);
  });

  it.fails("blocks a bare number in Devanagari digits in Spanish - known gap, #23", () => {
    expect(blockedEs("Los trenes [4] van con retrasos. Info: \u096D\u0967\u096E \u096B\u096B\u096B \u0966\u0967\u0968\u0969").length).toBeGreaterThan(0);
  });

  it.fails("blocks a bare number in keycap emoji digits in Spanish - known gap, #23", () => {
    expect(blockedEs(`Los trenes [4] van con retrasos. Info: ${keycaps}`).length).toBeGreaterThan(0);
  });

  // Regression guards for NFKC. Each host below is only a link AFTER normalization: HOST in
  // src/safety.ts matches letters and digits but needs a literal ".", and NFKC is what turns
  // these dots into one. Checked by running with .normalize("NFKC") removed: all three
  // return [] then, so they fail if the normalization is dropped.
  it("still blocks a host whose dot is a fullwidth full stop", () => {
    expect(blocked("[4] trains are delayed. Info: mta-refund\uFF0Etop").length).toBeGreaterThan(0);
  });

  it("still blocks a host whose dot is a small full stop", () => {
    expect(blocked("[4] trains are delayed. Info: mta-refund\uFE52top").length).toBeGreaterThan(0);
  });

  it("still blocks a host written with fullwidth digits and a fullwidth full stop", () => {
    expect(blocked("[4] trains are delayed. Info: mta\uFF17\uFF11\uFF18\uFF0Etop").length).toBeGreaterThan(0);
  });

  // Allow case: ordinary times, station numbers and line names in both languages.
  it("allows ordinary times and street numbers", () => {
    expect(
      checkRiderMessage(
        { en: "[4] trains are delayed near 149 St-Grand Concourse until 5:30 PM.", es: "Los trenes [4] van con retraso cerca de la 149 hasta las 5:30 PM." },
        alert,
      ),
    ).toEqual([]);
  });
});
