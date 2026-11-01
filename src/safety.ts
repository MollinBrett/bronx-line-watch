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

    for (const match of text.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/gi)) {
      const host = match[1]!.toLowerCase();
      // Any word.word is treated as a link: phones and Telegram make bare domains tappable on
      // every ending (.top, .nyc, ...), so there is no safe list of endings to skip (#22).
      // Station abbreviations ("Av.", "St.") don't match because a space follows the dot.
      if (!ALLOWED_LINK_HOSTS.includes(host)) problems.push(`${lang}: link to ${host}`);
    }

    const mentionsLine = alert.routes.some((r) =>
      new RegExp(`\\[${r}\\]|\\b${r}\\b`).test(text),
    );
    if (!mentionsLine) problems.push(`${lang}: doesn't name the affected line`);
  }
  return problems;
}
