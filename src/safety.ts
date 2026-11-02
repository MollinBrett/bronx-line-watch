import type { Alert } from "./mta.js";
import type { RiderMessage } from "./rewrite.js";

export const MAX_CHARS = 320;
const ALLOWED_LINK_HOSTS = ["mta.info", "new.mta.info"];

/**
 * Last line of defense before a text reaches real phones. Claude reads outside text
 * (MTA alerts), so we never trust its output blindly: anything odd is dropped, not sent.
 * Returns a list of problems; empty means safe to send.
 */
export function checkRiderMessage(msg: RiderMessage, alert: Alert): string[] {
  const problems: string[] = [];
  for (const [lang, text] of Object.entries(msg)) {
    if (!text.trim()) problems.push(`${lang}: empty`);
    if (text.length > MAX_CHARS) problems.push(`${lang}: ${text.length} chars (max ${MAX_CHARS})`);
    if (/<[a-z/][^>]*>/i.test(text)) problems.push(`${lang}: contains markup`);

    // Normalize first, so lookalike punctuation can't hide a link: NFKC turns the fullwidth
    // and ideographic dots into ".", and invisible characters are removed (#38).
    const norm = text.normalize("NFKC").replace(/\u3002/g, ".").replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");

    // Any word.word is treated as a link: phones and Telegram make bare domains tappable on
    // every ending (.top, .nyc, ...) and in every script (#22, #38). Unicode-aware, so a
    // Cyrillic "mta.info" or an accented host is still seen as a host, and IPv4 hosts too.
    // Station abbreviations ("Av.", "St.") don't match because a space follows the dot.
    const HOST = /(?:https?:\/\/)?((?:[\p{L}\p{M}\p{N}-]+\.)+(?:xn--[a-z0-9-]+|[\p{L}\p{M}]{2,})|\d{1,3}(?:\.\d{1,3}){3})(?:\/\S*)?/giu;
    const seen = new Set<string>();
    for (const match of norm.matchAll(HOST)) {
      const host = match[1]!.toLowerCase();
      if (ALLOWED_LINK_HOSTS.includes(host) || seen.has(host)) continue;
      seen.add(host);
      problems.push(`${lang}: link to ${host}`);
    }
    // Belt and braces: any scheme link must be to an allowed host, even one the pattern missed.
    for (const match of norm.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/giu)) {
      let host = "";
      try {
        const url = match[0].replace(/[.,;!?)'"\u2019\u201D]+$/u, "");
        host = new URL(url).hostname.toLowerCase();
      } catch {
        // Leave the host empty so invalid URLs are rejected below.
      }
      if (!ALLOWED_LINK_HOSTS.includes(host) && !seen.has(host)) {
        seen.add(host);
        problems.push(`${lang}: link to ${host || "(no host)"}`);
      }
    }
    // Rider texts are English or Spanish: the only non-ASCII letters they need are Spanish
    // ones. Anything else (Cyrillic, Greek, ...) is how lookalike links are built.
    const odd = [...new Set(norm.match(/[^\x00-\x7F\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D1\u00E1\u00E9\u00ED\u00F3\u00FA\u00FC\u00F1]/gu) ?? [])]
      .filter((ch) => /\p{L}/u.test(ch));
    if (odd.length) {
      problems.push(`${lang}: unexpected letters ${odd.map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ")}`);
    }

    const mentionsLine = alert.routes.some((r) =>
      new RegExp(`\\[${r}\\]|\\b${r}\\b`).test(text),
    );
    if (!mentionsLine) problems.push(`${lang}: doesn't name the affected line`);
  }
  return problems;
}
