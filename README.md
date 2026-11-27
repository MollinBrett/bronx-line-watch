# Bronx Line Watch

Plain-language subway alerts for Bronx riders, in **English and Spanish**, by text message
and Telegram, kept running by a small team of Claude agents.

The MTA publishes alerts like:

> [6] trains are running with delays in both directions after NYPD responded to an unauthorized person on the track at E 149 St.

Bronx Line Watch notices new alerts on the 2, 4, 5, 6, B and D within a minute, has Claude
rewrite them as a short neighborly text in English and Spanish, checks the result, and texts
subscribers in their language.

## How it works

```
MTA alert feed ──(every 60s, free)──> watcher ──(new alert only)──> Claude ──> safety check ──> Twilio SMS
                                         │
                                  data/state.json (what we already sent)
```

- **The watcher is plain code**, not an agent: polling every minute costs nothing. Claude is called
  only when an alert is new or changes - a few dozen times a day.
- **Claude's output is never trusted blindly.** MTA alert text is outside input, so the prompt treats
  it as data, and `src/safety.ts` blocks texts with links, markup, missing line names, or that run long.
- **The repo maintains itself** with two scheduled Managed Agents - a maintainer and a security guard -
  that open pull requests and issues. People review and merge. See [docs/agents.md](docs/agents.md).

| Path | What |
|---|---|
| `src/mta.ts` | Fetch and parse the MTA feed |
| `src/filter.ts` | Which alerts deserve a text |
| `src/state.ts` | Remember what was already sent |
| `src/rewrite.ts` | The Claude prompt and call |
| `src/safety.ts` | Last check before a text goes out |
| `src/sms.ts` | SMS segment math and Twilio |
| `src/breaker.ts` | Pauses the watcher when it sends or spends too much |
| `evals/` | Quality evals: Claude grades rewrites against `evals/rubric.md` |
| `agents/`, `environments/`, `vaults/` | The agent team, synced with `ant apply` |

## Run it

Node 22+.

```bash
npm install
```

```bash
npm test
```

Run once against the live feed, printing instead of texting (needs `ANTHROPIC_API_KEY`). The first
run only remembers current alerts; the next run shows anything new.

```bash
npm run once
```

Run continuously and send alerts: set the Telegram and/or Twilio variables from `.env.example`
(either one works alone; without both, it only prints). Texting also needs
`SEND_SMS=true`, which is set **only on Render**, so a laptop can never text real subscribers. Then:

```bash
npm start
```

Develop against your own test Telegram channel, with settings in a local `.env` file. It never
sends SMS. See [docs/ONBOARDING.md](docs/ONBOARDING.md#your-own-test-channel-see-real-posts-without-touching-production):

```bash
npm run dev
```

Check message quality after changing the prompt or model (how it works: [docs/EVALS.md](docs/EVALS.md)) (calls Claude, costs a few cents):

```bash
npm run eval
```

## Before texting real people
- US carriers require **A2P 10DLC registration** (or toll-free verification) for app-to-person SMS. Start it in the Twilio console early - approval takes days to weeks.
- Only text people who opted in. Twilio handles STOP replies automatically.

## Pausing and resuming

The watcher pauses itself when it is about to send or spend more than a normal day needs, and
stays paused until a person resumes it. While paused it keeps polling and logging, but makes no
Claude calls, posts nothing and texts no one. Alerts that come in while it is paused are never
sent afterwards: only alerts that are new, or that change, after it resumes go out.

It pauses itself (the breaker trips) just before going over any of these limits. Each is a
setting on Render; the defaults are about twice the busiest hour and one and a half times the
busiest day measured (Nov 12-19, 2026: 12 alerts in one hour, 78 in 24 hours).

| Setting | Default | Limit |
|---|---|---|
| `MAX_TEXTS_PER_HOUR` | 24 per subscriber | texts in any hour, all subscribers together |
| `MAX_TEXTS_PER_DAY` | 120 per subscriber | texts in any 24 hours, all subscribers together |
| `MAX_CLAUDE_CALLS_PER_HOUR` | 30 | Claude calls in any hour |
| `MAX_SAFETY_BLOCKS_IN_A_ROW` | 3 | messages in a row the safety check blocked |

`MAX_ALERTS_PER_POLL` (default 5) doesn't trip it: alerts over it wait for the next poll.

**Getting told.** When it trips, the bot posts what happened and how to resume to a private
Telegram chat: set `TELEGRAM_CHANNEL_ADMIN` to that chat's numeric id (a private channel's
starts with `-100`; see [docs/ONBOARDING.md](docs/ONBOARDING.md#your-own-test-channel-see-real-posts-without-touching-production)
for how to find it) and add the bot to it. Never use a public channel. Without it, only the
Render logs say so: look for lines starting with `[breaker]`. If Telegram is down, it keeps trying:
every poll for half an hour, then once an hour.

**Pause it by hand.** On Render, open the service's Environment page, set `PAUSED` to `true`,
and choose **Save and deploy** ("Save only" changes nothing until the next deploy). Anything
other than `false`, `0`, `no`, `off` or blank counts as paused. Remove it, or set it to `false`,
the same way to switch it back on.

**Resume after it paused itself.** First find out what went wrong, in the Render logs. Then set
`RESUME_AFTER_TRIP` to the code in the Telegram alert (it is also in the logs), and choose
**Save and deploy**. The code only works for that one pause, so it can stay set: if the watcher
pauses itself again later, that pause has a new code.

**Keep the state file on a persistent disk.** The pause, and the counts, live in the state file
(`STATE_FILE`, by default `data/state.json`). On Render without a persistent disk, every deploy
and restart starts with an empty disk, so a new deploy forgets the pause. Attach a persistent
disk to the service (for example at `/var/data`) and set `STATE_FILE=/var/data/state.json`.
Until then, set `PAUSED=true` as well to be sure it stays off.

## What's next
New here? Start with [docs/ONBOARDING.md](docs/ONBOARDING.md). Open work: [docs/starter-issues.md](docs/starter-issues.md).
