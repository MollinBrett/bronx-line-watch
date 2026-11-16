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
const blocked = (en: string) => checkRiderMessage({ en, es }, alert);

describe("checkRiderMessage vs. phone numbers in non-ASCII digits", () => {
  it.fails("blocks a callback number in Arabic-Indic digits - known gap, #23", () => {
    expect(blocked("[4] delayed. For a fare refund call \u0667\u0661\u0668-\u0665\u0665\u0665-\u0660\u0661\u0662\u0663").length).toBeGreaterThan(0);
  });

  it.fails("blocks a callback number in Devanagari digits - known gap, #23", () => {
    expect(blocked("[4] delayed. For a fare refund call \u096D\u0967\u096E \u096B\u096B\u096B \u0966\u0967\u0968\u0969").length).toBeGreaterThan(0);
  });

  it.fails("blocks a callback number in keycap emoji digits - known gap, #23", () => {
    const keycaps = [..."7185550123"].map((d) => `${d}\uFE0F\u20E3`).join("");
    expect(blocked(`[4] delayed. For a fare refund call ${keycaps}`).length).toBeGreaterThan(0);
  });

  it.fails("blocks a callback number in Arabic-Indic digits in Spanish - known gap, #23", () => {
    const esBad = "Los trenes [4] van con retrasos. Para un reembolso llama al \u0667\u0661\u0668-\u0665\u0665\u0665-\u0660\u0661\u0662\u0663";
    expect(checkRiderMessage({ en: "[4] trains are delayed.", es: esBad }, alert).length).toBeGreaterThan(0);
  });

  // Regression guards: NFKC already folds these to ASCII digits and letters, so a fix
  // that checks the normalized text sees them. Today they're caught only where they also
  // spell a link; these just pin that the normalization stays in place.
  it("folds fullwidth digits in a host to ASCII and still blocks the link", () => {
    expect(blocked("[4] delayed. Refunds: mta\uFF17\uFF11\uFF18.top").length).toBeGreaterThan(0);
  });

  it("folds mathematical bold letters in a host and still blocks the link", () => {
    expect(blocked("[4] delayed. Refunds: \u{1D426}\u{1D42D}\u{1D41A}-refund.top").length).toBeGreaterThan(0);
  });

  // Allow case: ordinary times, station numbers and line names in both languages.
  it("allows ordinary times and street numbers", () => {
    expect(
      checkRiderMessage(
        { en: "[4] trains are delayed near 149 St-Grand Concourse until 5:30 PM.", es: "Los trains [4] van con retraso cerca de la 149 hasta las 5:30 PM." },
        alert,
      ),
    ).toEqual([]);
  });
});
