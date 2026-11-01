export type Lang = "en" | "es";

export interface Subscriber {
  phone: string;
  lang: Lang;
}

/** Parse "+17185550100:es,+13475550199:en" (language defaults to en). */
export function parseSubscribers(raw: string | undefined): Subscriber[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((entry) => {
    const [phone = "", lang = "en"] = entry.trim().split(":");
    if (!/^\+1\d{10}$/.test(phone)) throw new Error(`Bad phone number in SMS_SUBSCRIBERS: ${phone}`);
    if (lang !== "en" && lang !== "es") throw new Error(`Bad language for ${phone}: ${lang}`);
    return { phone, lang };
  });
}

// GSM-7: the basic character set that fits 160 characters in one SMS segment.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€"; // these cost two characters each

/**
 * How many SMS segments a message costs. Carriers bill per segment.
 * One character outside GSM-7 (like Spanish á, í, ó, ú) switches the whole
 * message to UCS-2, which fits only 70 characters per segment.
 */
export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; segments: number } {
  let gsmLength = 0;
  let isGsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      isGsm = false;
      break;
    }
  }
  if (isGsm) return { encoding: "GSM-7", segments: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153) };
  const units = text.length; // UTF-16 code units
  return { encoding: "UCS-2", segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

export function twilioConfigFromEnv(env = process.env): TwilioConfig | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return null;
  return { accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM_NUMBER };
}

/** Send one SMS through Twilio's REST API (plain fetch - no extra dependency). */
export async function sendSms(cfg: TwilioConfig, to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: cfg.from, Body: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Twilio returned HTTP ${res.status}: ${await res.text()}`);
}
