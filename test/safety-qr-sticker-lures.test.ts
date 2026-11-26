import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// A planted QR code or NFC sticker in a station is a link the check never sees. "Scan the QR
// code by the turnstiles for your refund" or "tap your phone on the sticker by the fare
// machine" sends riders to whatever the attacker stuck there, and the text itself has no link,
// number, handle or keyword. Rider texts about service changes never need to say this (#116).
const alert = makeAlert({ routes: ["4"] });
const en = "[4] trains are delayed in both directions.";
const es = "Los trains [4] van con retrasos en ambas direcciones.";
const checkEn = (text: string) => checkRiderMessage({ en: text, es }, alert);
const checkEs = (text: string) => checkRiderMessage({ en, es: text }, alert);

describe("checkRiderMessage vs. QR-code and NFC-sticker lures", () => {
  it.fails("blocks scan-the-QR-code lures in English - known gap, #116", () => {
    for (const text of [
      "[4] delayed. Scan the QR code on the poster by the turnstiles to get your fare refunded.",
      "[4] delayed. Riders can claim a free ride: scan the blue QR sticker on any OMNY reader.",
      "[4] delayed. Point your camera at the QR code at the station booth for a refund.",
      "[4] delayed. For live updates, scan the code on the platform sign at 149 St-Grand Concourse.",
    ]) {
      expect(checkEn(text), text).not.toEqual([]);
    }
  });

  it.fails("blocks scan-the-QR-code lures in Spanish - known gap, #116", () => {
    for (const text of [
      "Los trains [4] van con retrasos. Escanea el c\u00F3digo QR del cartel junto a los torniquetes para tu reembolso.",
      "Los trains [4] van con retrasos. Escanea el QR en la m\u00E1quina de MetroCard para recibir cr\u00E9dito.",
    ]) {
      expect(checkEs(text), text).not.toEqual([]);
    }
  });

  it.fails("blocks tap-your-phone-on-the-sticker (NFC) lures - known gap, #116", () => {
    expect(checkEn("[4] delayed. Tap your phone on the MTA sticker next to the fare machine for a credit.")).not.toEqual([]);
    expect(
      checkEs("Los trains [4] van con retrasos. Acerca tu celular a la calcoman\u00EDa azul del lector OMNY para un viaje gratis."),
    ).not.toEqual([]);
  });

  // Regression guard: the same lure with the link written out is caught today and must stay caught.
  it("blocks the same lure when the text carries the link", () => {
    expect(checkEn("[4] delayed. Scan the QR code: https://mta-refund.top/qr")).not.toEqual([]);
    expect(checkEn("[4] delayed. Scan the QR code at qr.mta-refund.top to get your fare back.")).not.toEqual([]);
    expect(checkEs("Los trains [4] van con retrasos. Escanea el QR: omny-reembolso.com")).not.toEqual([]);
  });

  // Allow cases: ordinary rewrites that must keep passing once the fix lands, including everyday
  // fare language ("tap your OMNY card") and platform signs and clocks.
  it("allows ordinary advice, including tapping an OMNY card and checking platform signs", () => {
    expect(checkEn("[4] trains are delayed. Allow extra time; check the countdown clock on the platform.")).toEqual([]);
    expect(checkEn("[4] trains skip 138 St. Tap your OMNY card as usual and transfer at 149 St-Grand Concourse.")).toEqual([]);
    expect(checkEs("Los trains [4] van con retrasos. Mira el reloj del and\u00E9n y sal con tiempo.")).toEqual([]);
  });
});
