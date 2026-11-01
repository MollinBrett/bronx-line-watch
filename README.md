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
(either one works alone; without both, it only prints), then:

```bash
npm start
```

Check message quality after changing the prompt or model (calls Claude, costs a few cents):

```bash
npm run eval
```

## Before texting real people
- US carriers require **A2P 10DLC registration** (or toll-free verification) for app-to-person SMS. Start it in the Twilio console early - approval takes days to weeks.
- Only text people who opted in. Twilio handles STOP replies automatically.

## What's next
New here? Start with [docs/ONBOARDING.md](docs/ONBOARDING.md). Open work: [docs/starter-issues.md](docs/starter-issues.md).
