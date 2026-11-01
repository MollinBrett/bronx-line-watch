import Anthropic from "@anthropic-ai/sdk";
import { textworthy } from "./filter.js";
import { fetchAlerts } from "./mta.js";
import { checkClaude } from "./preflight.js";
import { rewriteAlert, type RewriteOptions } from "./rewrite.js";
import { checkRiderMessage } from "./safety.js";
import { parseSubscribers, sendSms, smsSegments, twilioConfigFromEnv } from "./sms.js";
import { loadState, planAnnouncements, saveState } from "./state.js";
import { postToTelegram, telegramConfigFromEnv, telegramPosts } from "./telegram.js";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");
// --no-sms: local development never texts real phones, even if Twilio settings are present.
const twilio = dryRun || args.has("--no-sms") ? null : twilioConfigFromEnv();
const telegram = dryRun ? null : telegramConfigFromEnv();
const subscribers = parseSubscribers(process.env.SMS_SUBSCRIBERS);
const pollSeconds = Number(process.env.POLL_SECONDS ?? 60);
const stateFile = process.env.STATE_FILE ?? "data/state.json";
const rewriteOpts: RewriteOptions = {
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  effort: (process.env.CLAUDE_EFFORT as RewriteOptions["effort"]) ?? "low",
};

const claude = new Anthropic();

async function tick(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const candidates = textworthy(await fetchAlerts(), nowSeconds);
  const previous = await loadState(stateFile);
  const { toAnnounce, next } = planAnnouncements(candidates, previous ?? { announced: {} });

  if (previous === null && !args.has("--announce-existing")) {
    // First run: remember what's already going on instead of blasting a pile of texts.
    console.log(`[watch] first run - priming with ${candidates.length} current alerts, sending nothing`);
    await saveState(stateFile, next);
    return;
  }

  for (const alert of toAnnounce) {
    let msg;
    try {
      msg = await rewriteAlert(claude, alert, rewriteOpts);
    } catch (err) {
      // An API error on one alert must not stop the others (or re-text the ones already sent).
      console.error(`[rewrite] ${alert.id} failed:`, err);
      msg = null;
    }
    if (!msg) {
      delete next.announced[alert.id]; // retry next tick
      continue;
    }
    const problems = checkRiderMessage(msg, alert);
    if (problems.length) {
      console.warn(`[safety] blocked ${alert.id}: ${problems.join("; ")}`);
      continue; // stays marked as announced, so a bad rewrite is not retried every minute
    }

    console.log(`\n[${alert.routes.join(",")}] ${alert.type}\n  EN: ${msg.en}\n  ES: ${msg.es}`);
    for (const lang of ["en", "es"] as const) {
      const { segments, encoding } = smsSegments(msg[lang]);
      console.log(`  ${lang}: ${segments} segment(s), ${encoding}`);
    }

    // Each channel is independent: a failure in one never blocks the other.
    if (telegram) {
      for (const post of telegramPosts(telegram, msg)) {
        try {
          await postToTelegram(telegram, post.chatId, post.text);
        } catch (err) {
          console.error(`[telegram] failed to post to ${post.chatId}:`, err);
        }
      }
    }
    if (twilio) {
      for (const sub of subscribers) {
        try {
          await sendSms(twilio, sub.phone, msg[sub.lang]);
        } catch (err) {
          console.error(`[sms] failed to text ${sub.phone.slice(0, -4)}XXXX:`, err);
        }
      }
    }
  }
  await saveState(stateFile, next);
  console.log(`[watch] ${new Date().toISOString()} - ${candidates.length} active, ${toAnnounce.length} new`);
}

async function main(): Promise<void> {
  const preflight = await checkClaude(claude, rewriteOpts.model!);
  if (preflight.ok) console.log(`[startup] ${preflight.message}`);
  else if (preflight.fatal) {
    console.error(`[startup] ${preflight.message}`);
    process.exit(1); // fail the deploy loudly instead of running without working rewrites
  } else console.warn(`[startup] ${preflight.message}`);

  const outputs = [
    telegram && `Telegram (${[...new Set([telegram.channelEn, telegram.channelEs])].join(", ")})`,
    twilio && `SMS to ${subscribers.length} subscriber(s)`,
  ].filter(Boolean);
  console.log(`[watch] polling every ${pollSeconds}s; sending to: ${outputs.join(" + ") || "nothing - dry run (printing only)"}`);
  do {
    try {
      await tick();
    } catch (err) {
      console.error("[watch] tick failed:", err); // keep going; the next tick may succeed
    }
    if (!once) await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  } while (!once);
}

await main();
