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
      // Skip things like "St." or "Av." that look like hosts only by accident.
      if (!match[0].includes("/") && !/\.(com|net|org|info|io|ly|co|me|app|xyz|gov)$/.test(host)) continue;
      if (!ALLOWED_LINK_HOSTS.includes(host)) problems.push(`${lang}: link to ${host}`);
    }

    const mentionsLine = alert.routes.some((r) =>
      new RegExp(`\\[${r}\\]|\\b${r}\\b`).test(text),
    );
    if (!mentionsLine) problems.push(`${lang}: doesn't name the affected line`);
  }
  return problems;
}
