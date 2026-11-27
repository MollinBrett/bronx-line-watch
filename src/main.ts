import Anthropic from "@anthropic-ai/sdk";
import {
  MAX_ALERT_TRIES,
  alertDue,
  allowClaudeCall,
  allowTexts,
  breakerSettingsFromEnv,
  claudeCallNotBilled,
  pollSecondsFromEnv,
  recordSafetyCheck,
  restoreBreaker,
  resumeCode,
  textsNotSent,
  tripReason,
  tripTime,
  type Breaker,
} from "./breaker.js";
import { textworthy } from "./filter.js";
import { fetchAlerts, type Alert } from "./mta.js";
import { checkClaude } from "./preflight.js";
import { rewriteAlert, rewriteOptionsFromEnv } from "./rewrite.js";
import { checkRiderMessage } from "./safety.js";
import { parseSubscribers, sendSms, smsSegments, twilioConfigFromEnv, wantsAlert } from "./sms.js";
import { DEFAULT_LIMITS, forget, loadState, planAnnouncements, primed, saveState, without, type State } from "./state.js";
import { adminChatFromEnv, postToTelegram, postTripAlert, telegramConfigFromEnv, telegramPosts } from "./telegram.js";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const dryRun = args.has("--dry-run");
const announceExisting = args.has("--announce-existing");
// --no-sms: local development never texts real phones, even if Twilio settings are present.
const twilio = dryRun || args.has("--no-sms") ? null : twilioConfigFromEnv();
if (!twilio && process.env.TWILIO_ACCOUNT_SID && process.env.SEND_SMS !== "true" && !dryRun) {
  console.warn("[sms] Twilio settings found but SEND_SMS is not \"true\": not texting anyone (set SEND_SMS=true only on Render)");
}
const telegram = dryRun ? null : telegramConfigFromEnv();
const adminChat = dryRun ? null : adminChatFromEnv();
const subscribers = parseSubscribers(process.env.SMS_SUBSCRIBERS);
const pollSeconds = pollSecondsFromEnv(process.env.POLL_SECONDS);
const stateFile = process.env.STATE_FILE ?? "data/state.json";
const rewriteOpts = rewriteOptionsFromEnv();
const settings = breakerSettingsFromEnv(subscribers.length);

const claude = new Anthropic();
/** The circuit breaker's memory (#56): read from the state file on the first poll, then kept here. */
let breaker: Breaker | undefined;

async function tick(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const candidates = textworthy(await fetchAlerts(), nowSeconds);
  const previous = await loadState(stateFile);
  if (!breaker) {
    const restored = restoreBreaker(previous?.breaker, settings.resumeCode, nowSeconds);
    if (restored.note) console.warn(`[breaker] ${restored.note}`);
    breaker = restored.breaker;
  }
  const b = breaker;
  // Every save carries the breaker's memory, so a trip and its counts survive a restart.
  const save = (state: State) => saveState(stateFile, { ...state, breaker: b });
  const stamp = new Date().toISOString();

  const paused = settings.paused ?? (b.tripped ? `tripped: ${tripReason(b.tripped)}` : null);
  if (paused) {
    // Paused: no Claude call, no post, no text. It keeps marking what is in the feed as
    // announced, so resuming never sends a backlog.
    // Saved first, so the trip and its resume code are on disk before anyone is told the code.
    const remembered = primed(candidates, nowSeconds, previous ?? undefined);
    await save(remembered);
    if (await tellOperators(b, nowSeconds)) await save(remembered);
    const resume = b.tripped ? `; to resume, set RESUME_AFTER_TRIP=${resumeCode(b.tripped)}` : "";
    console.log(`[watch] ${stamp} - PAUSED (${paused}${resume}) - ${candidates.length} active, nothing sent`);
    return;
  }

  if (previous === null && !announceExisting) {
    // First run: remember what's already going on instead of blasting a pile of texts.
    console.log(
      `[watch] first run (no ${stateFile}) - priming with ${candidates.length} current alerts, sending nothing. ` +
        "If this service has run before, its state file was lost: keep it on a persistent disk, or a pause won't survive a restart",
    );
    await save(primed(candidates, nowSeconds));
    return;
  }

  // --announce-existing (local development) sends what is already in the feed on purpose, so a
  // long list is not a flood there. It is still sent a few alerts per poll.
  const perPoll = { ...DEFAULT_LIMITS, maxPerTick: settings.alertsPerPoll };
  const limits = previous === null ? { ...perPoll, floodAbove: Infinity } : perPoll;
  const { toAnnounce, next, deferred, flood } = planAnnouncements(
    candidates,
    previous ?? { announced: {} },
    nowSeconds,
    limits,
  );
  if (flood) {
    console.error(
      `[watch] more than ${limits.floodAbove} new alerts in one poll - treating the feed as broken: ` +
        "sending nothing and marking them all as announced",
    );
  }
  if (deferred) console.warn(`[watch] ${deferred} new alert(s) held for the next poll (at most ${limits.maxPerTick} per poll)`);

  // The state is saved after every alert, without the alerts not handled yet. Whatever stops
  // this loop early, an alert that was already sent is never sent again (#52).
  const notHandled = new Set(toAnnounce.map((a) => a.id));
  const saveProgress = () => save(without(next, notHandled));
  for (const alert of toAnnounce) {
    if (!allowClaudeCall(b, settings, nowSeconds)) break; // over the limit: the breaker has tripped
    // The call is on record before it is made, so a crash can't hide it. And nothing is spent
    // unless the state file can be written: the next poll must know what this one did.
    try {
      await saveProgress();
    } catch (err) {
      claudeCallNotBilled(b, nowSeconds); // the call was never made
      throw err;
    }
    let nothingSent: unknown;
    try {
      await announce(alert, next, b, nowSeconds, async (texts) => {
        if (!allowTexts(b, settings, texts, nowSeconds)) return false;
        // Saved before anything goes out: from here the alert counts as announced and its
        // texts as sent, even if the process dies part-way through sending.
        notHandled.delete(alert.id);
        try {
          await saveProgress();
        } catch (err) {
          // Not saved, so not sent: the alert stays new and its texts are not counted.
          notHandled.add(alert.id);
          textsNotSent(b, texts, nowSeconds);
          nothingSent = err;
          throw err;
        }
        return true;
      });
    } catch (err) {
      if (nothingSent) throw err; // the state file can't be written: stop this poll
      // Something may already have gone out, so the alert stays marked as announced.
      console.error(`[watch] ${alert.id} failed part-way; not retrying it:`, err);
    }
    notHandled.delete(alert.id);
    await saveProgress();
  }
  await saveProgress();
  if (b.tripped) {
    console.error(
      `[breaker] TRIPPED on ${tripTime(b.tripped)}: ${tripReason(b.tripped)}. Nothing more is sent until a person ` +
        `resumes it: set RESUME_AFTER_TRIP=${resumeCode(b.tripped)} (README, "Pausing and resuming")`,
    );
    if (await tellOperators(b, nowSeconds)) await saveProgress();
  }
  console.log(`[watch] ${stamp} - ${candidates.length} active, ${toAnnounce.length} new`);
}

/**
 * Rewrite one alert, check it, and send it to every channel. `maySend` is asked once, with the
 * number of texts, just before anything goes out; false means the breaker has tripped.
 */
async function announce(
  alert: Alert,
  next: State,
  b: Breaker,
  nowSeconds: number,
  maySend: (texts: number) => Promise<boolean>,
): Promise<void> {
  let msg;
  try {
    msg = await rewriteAlert(claude, alert, rewriteOpts);
  } catch (err) {
    // An API error on one alert must not stop the others (or re-text the ones already sent).
    console.error(`[rewrite] ${alert.id} failed:`, err);
    msg = null;
    // Turned away by the API with an error status: not billed, so an outage at Anthropic doesn't
    // trip the breaker. Anything else (a lost connection, an answer that didn't parse) may
    // have been billed, and stays counted.
    if (err instanceof Anthropic.APIError && err.status !== undefined) claudeCallNotBilled(b, nowSeconds);
  }
  if (!msg) {
    forget(next, alert.id); // retry next tick
    return;
  }
  const problems = checkRiderMessage(msg, alert);
  recordSafetyCheck(b, settings, problems.length > 0, nowSeconds);
  if (problems.length) {
    console.warn(`[safety] blocked ${alert.id}: ${problems.join("; ")}`);
    return; // stays marked as announced, so a bad rewrite is not retried every minute
  }

  console.log(`\n[${alert.routes.join(",")}] ${alert.type}\n  EN: ${msg.en}\n  ES: ${msg.es}`);
  for (const lang of ["en", "es"] as const) {
    const { segments, encoding } = smsSegments(msg[lang]);
    console.log(`  ${lang}: ${segments} segment(s), ${encoding}`);
  }

  // They only get it if they asked for one of its lines, or one of its stations (#49).
  const recipients = twilio ? subscribers.filter((sub) => wantsAlert(sub, alert)) : [];
  if (!(await maySend(recipients.length))) return;

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
    for (const sub of recipients) {
      try {
        await sendSms(twilio, sub.phone, msg[sub.lang]);
      } catch (err) {
        console.error(`[sms] failed to text ${sub.phone.slice(0, -4)}XXXX:`, err);
      }
    }
  }
}

/**
 * Tell the operators, in their private chat, that the breaker tripped. Tried again on later
 * polls until it gets through. Returns whether it tried, so the caller saves the result.
 */
async function tellOperators(b: Breaker, nowSeconds: number): Promise<boolean> {
  const trip = b.tripped;
  if (!trip || !adminChat || !alertDue(trip, nowSeconds)) return false;
  trip.alertTries += 1;
  try {
    await postTripAlert(adminChat, trip);
    trip.alerted = true;
    console.log("[breaker] told the operators in their private Telegram chat");
  } catch (err) {
    console.error(`[breaker] could not tell the operators (try ${trip.alertTries}; hourly after ${MAX_ALERT_TRIES}):`, err);
  }
  return true;
}

async function main(): Promise<void> {
  if (settings.paused) {
    console.warn(`[startup] ${settings.paused}: watching and logging only. No Claude calls, no Telegram posts, no texts`);
  } else {
    const preflight = await checkClaude(claude, rewriteOpts.model);
    if (preflight.ok) console.log(`[startup] ${preflight.message}`);
    else if (preflight.fatal) {
      console.error(`[startup] ${preflight.message}`);
      process.exit(1); // fail the deploy loudly instead of running without working rewrites
    } else console.warn(`[startup] ${preflight.message}`);
  }

  const outputs = [
    telegram && `Telegram (${[...new Set([telegram.channelEn, telegram.channelEs])].join(", ")})`,
    twilio && `SMS to ${subscribers.length} subscriber(s)`,
  ].filter(Boolean);
  console.log(`[watch] polling every ${pollSeconds}s; sending to: ${outputs.join(" + ") || "nothing - dry run (printing only)"}`);
  console.log(
    `[breaker] pauses itself above ${settings.claudeCallsPerHour} Claude calls an hour, ${settings.textsPerHour} texts an hour, ` +
      `${settings.textsPerDay} texts a day, or at ${settings.safetyBlocksInARow} safety blocks in a row; at most ${settings.alertsPerPoll} alerts per poll`,
  );
  if (!adminChat && !dryRun) {
    console.warn("[breaker] TELEGRAM_CHANNEL_ADMIN is not set: if the watcher pauses itself, only these logs will say so");
  }
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
