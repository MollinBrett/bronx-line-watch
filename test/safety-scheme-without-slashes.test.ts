import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// The scheme check in safety.ts only fires on "scheme://", and the host pattern needs a dotted
// "name.tld". A scheme link written without slashes has neither: "tg:resolve?domain=x_bot" opens
// a Telegram bot, "ton:transfer/..." asks for a wallet payment, "sms:" prefills a reply (#86).
// Rider texts never need a URL scheme, so any "word:" glued to a target should be blocked.
const alert = makeAlert({ routes: ["4"] });
const es = "Los trenes [4] van con retrasos en ambas direcciones.";
const blocked = (en: string) => checkRiderMessage({ en, es }, alert);

describe("checkRiderMessage vs. URL schemes without //", () => {
  it.fails("blocks scheme links with no slashes - known gap, #86", () => {
    for (const en of [
      "[4] delayed. Fare refunds: tg:resolve?domain=mta_refund_bot",
      "[4] delayed. Fare refunds: TG:resolve?domain=mta_refund_bot&start=claim",
      "[4] delayed. Fare refunds: tg:join?invite=AbCdEf123",
      "[4] delayed. Fare refunds: tg:/resolve?domain=mta_refund_bot",
      "[4] delayed. Fare refunds: ton:transfer/EQabc?amount=1",
      "[4] delayed. Fare refunds: tonsite:mtarefund",
    ]) {
      expect(blocked(en).length, en).toBeGreaterThan(0);
    }
    const esBad = "Los trenes [4] van con retrasos. Reembolsos: tg:resolve?domain=mta_reembolso_bot";
    expect(checkRiderMessage({ en: "[4] trains are delayed.", es: esBad }, alert).length).toBeGreaterThan(0);
  });

  // Regression guards: caught today, and must stay caught when the fix for #86 lands.
  it("blocks the same links written with //", () => {
    expect(blocked("[4] delayed. Fare refunds: tg://resolve?domain=mta_refund_bot").length).toBeGreaterThan(0);
    expect(blocked("[4] delayed. Fare refunds: ton://transfer/EQabc?amount=1").length).toBeGreaterThan(0);
  });

  it("blocks scheme-without-slashes links that still have a dotted host", () => {
    expect(blocked("[4] delayed. https:mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. mailto:claims@mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  // Allow cases: a stricter check must not drop ordinary rider texts.
  it("allows times, labels with a space after the colon, and the real MTA site", () => {
    for (const en of [
      "[4] trains are delayed until 5:30 PM. Next train at 6:02.",
      "[4] trains are delayed. Note: allow extra time.",
      "[4] trains are delayed. Details: https://new.mta.info/alerts",
    ]) {
      expect(blocked(en), en).toEqual([]);
    }
    expect(checkRiderMessage({ en: "[4] trains are delayed.", es: "Los trenes [4] van con retrasos. Nota: salgan temprano." }, alert)).toEqual([]);
  });
});
