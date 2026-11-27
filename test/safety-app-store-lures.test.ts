import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// A lure doesn't need a link, a number or a handle. "Install the OMNY Rewards app",
// "search 'OMNY Refund' in the App Store" or "join the MTA_Free_WiFi network" send riders
// to something the attacker controls (a lookalike app, a poisoned search result, an evil-twin
// hotspot) with none of the shapes the other checks look for. Rider texts never need any of them.
const alert = makeAlert({ routes: ["4"] });
const en = "[4] trains are delayed in both directions.";
const es = "Los trains [4] van con retrasos en ambas direcciones.";
const checkEn = (text: string) => checkRiderMessage({ en: text, es }, alert);
const checkEs = (text: string) => checkRiderMessage({ en, es: text }, alert);

describe("checkRiderMessage vs. app, store, search and Wi-Fi lures", () => {
  it.fails("blocks app-install and app-store lures in English - known gap, #107", () => {
    for (const text of [
      "[4] delayed. Riders get a free week: install the OMNY Rewards app from Google Play.",
      "[4] delayed. Get live updates: download Bronx Train Tracker from the App Store.",
      "[4] delayed. Search \"OMNY Refund\" in the App Store to claim your fare back.",
      "[4] delayed. Google \u201COMNY fare credit\u201D to get your money back.",
    ]) {
      expect(checkEn(text), text).not.toEqual([]);
    }
  });

  it.fails("blocks app-install and app-store lures in Spanish - known gap, #107", () => {
    for (const text of [
      "Los trains [4] van con retrasos. Descarga la app OMNY Premios para un pase gratis.",
      "Los trains [4] van con retrasos. Busca \u201COMNY Reembolso\u201D en Google Play.",
      "Los trains [4] van con retrasos. Instala la app oficial para recibir tu cr\u00E9dito.",
    ]) {
      expect(checkEs(text), text).not.toEqual([]);
    }
  });

  it.fails("blocks a Wi-Fi network to join - known gap, #107", () => {
    for (const text of [
      "[4] delayed. Free station Wi-Fi: join MTA_Free_WiFi and sign in with your OMNY card.",
      "[4] delayed. Connect to the TransitWirelessFree hotspot for live updates.",
    ]) {
      expect(checkEn(text), text).not.toEqual([]);
    }
    expect(checkEs("Los trains [4] van con retrasos. Con\u00E9ctate al wifi MTA_Gratis para m\u00E1s info.")).not.toEqual([]);
  });

  // Regression guard: the link form of the same lure is caught today and must stay caught.
  it("blocks the same lure when it carries a store link", () => {
    expect(checkEn("[4] delayed. Get the app: play.google.com/store/apps/details?id=omny.rewards")).not.toEqual([]);
    expect(checkEn("[4] delayed. Get the app: https://apps.apple.com/app/id123")).not.toEqual([]);
  });

  // Allow cases: ordinary rewrites that must keep passing once the fix lands. Claude may
  // mention the MTA's own app in passing, or tell riders to look for another route.
  it("allows ordinary advice, including 'stop', 'store' and 'busca otra ruta'", () => {
    expect(checkEn("[4] trains are delayed. Allow extra time, or take the [4] from the next stop.")).toEqual([]);
    expect(checkEn("[4] trains skip 149 St-Grand Concourse. Check the MYmta app for updates.")).toEqual([]);
    expect(checkEs("Los trains [4] van con retrasos. Busca otra ruta o sal con tiempo.")).toEqual([]);
    expect(checkEs("Los trains [4] no paran en la 138 por trabajos en las instalaciones.")).toEqual([]);
  });
});
