import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// #23: callback phone numbers aren't blocked yet. The fix suggested there counts digits, so a
// number written out in words ("seven one eight, five five five...") would still get through.
// Writing digits as words is the standard way to get a number past a filter, and a rider can
// dial it just as easily. These guards make sure the #23 fix covers it in both languages.
const alert = makeAlert({ routes: ["4"] });
const en = "[4] trains are delayed in both directions.";
const es = "Los trains [4] van con retrasos en ambas direcciones.";

describe("checkRiderMessage vs. phone numbers written in words", () => {
  it.fails("blocks a callback number spelled out in English - known gap, #23", () => {
    for (const text of [
      "[4] delayed. For a fare credit call seven one eight, five five five, zero one two three.",
      "[4] delayed. Fare credit line: seven-one-eight five-five-five oh-one-two-three.",
      "[4] delayed. For a fare credit call SEVEN 1 EIGHT 555 zero 1 two 3.",
    ]) {
      expect(checkRiderMessage({ en: text, es }, alert), text).not.toEqual([]);
    }
  });

  it.fails("blocks a callback number spelled out in Spanish - known gap, #23", () => {
    const text = "Los trains [4] van con retrasos. Para tu cr\u00E9dito llama al siete uno ocho, cinco cinco cinco, cero uno dos tres.";
    expect(checkRiderMessage({ en, es: text }, alert)).not.toEqual([]);
  });

  // Allow cases: ordinary numbers in words must keep passing once the #23 fix lands.
  it("allows a few number words in ordinary rider text", () => {
    expect(checkRiderMessage({ en: "[4] trains are running every ten to twelve minutes in both directions.", es }, alert)).toEqual([]);
    expect(checkRiderMessage({ en, es: "Los trains [4] pasan cada diez o doce minutos. Sal con tiempo." }, alert)).toEqual([]);
    expect(checkRiderMessage({ en: "[4] trains skip two stops: 138 St and 149 St-Grand Concourse.", es }, alert)).toEqual([]);
  });
});
