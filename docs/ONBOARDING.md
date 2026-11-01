# Welcome, Angel

You're joining a project that's already live: Bronx Line Watch turns MTA subway alerts into
plain-language English and Spanish messages for Bronx riders. It's maintained partly by AI
agents, and the point of this project is for you to learn to build, steer, and supervise them.

You won't be writing a lot of code at first. You'll be **reviewing what agents wrote, deciding
what "good" means, and building agents of your own.** That's increasingly what the job is.

## What's running right now

| Piece | Where | What it does |
|---|---|---|
| **Watcher** | Render (always on) | Checks the MTA's alert feed every minute. When a Bronx line has a new disruption, asks Claude to rewrite it, runs a safety check, and posts it. |
| **Telegram** | [@bronxlinewatch](https://t.me/bronxlinewatch), [@bronxlinewatch_es](https://t.me/bronxlinewatch_es) | Where alerts go today. |
| **SMS** | (888) 527-6698 (888-5-BRONX-8) | Turns on once Twilio approves the number. |
| **Website** | [mollinbrett.github.io/bronx-line-watch](https://mollinbrett.github.io/bronx-line-watch/) | Sign-up page, terms, privacy policy. Served from `docs/`. |
| **Maintainer agent** | Claude Managed Agents, daily 4:15 AM | Runs the tests, checks the feed, upgrades packages, and implements `agent-ok` issues. Opens pull requests. |
| **Security guard agent** | Claude Managed Agents, daily 5:45 AM | Looks for leaked secrets, vulnerable packages, and prompt-injection holes. Files `security` issues. |

```
MTA feed ──every 60s──> watcher ──new alert──> Claude ──> safety check ──> Telegram / SMS
                                                                ▲
              security guard probes this every morning ─────────┘
```

Every change, from a person or an agent, goes through a pull request, and nothing merges without
a second person's approval. **For agent pull requests, that second person is you.**

## Day one setup (about 30 minutes)

You'll need Node 22+, git, and an Anthropic API key. Brett invited you to the
**bronx-line-watch** workspace in the [Claude Console](https://platform.claude.com): create your
key there (Settings → API Keys). That workspace has a spend limit, so experiment freely.

```bash
git clone https://github.com/MollinBrett/bronx-line-watch.git
```

```bash
cd bronx-line-watch && npm install
```

```bash
npm test
```

All tests should pass (a couple are marked "expected fail": those are open bugs waiting for a fix,
one of them yours). Now set your key for this terminal and run the watcher once against the live
MTA feed. It only prints; it never posts or texts. The first run just records the current alerts;
run it again later to see Claude's rewrite of anything new.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm run once
```

Then the fun one: Claude rewrites a set of test alerts and a second Claude call grades each one
against `evals/rubric.md`. It costs a few cents per run.

```bash
npm run eval
```

## Your own test channel: see real posts without touching production

Branch protection only controls what merges into `main` (what goes live). Everything before
that is yours: run it locally, push branches as often as you like (CI tests every push), and
open draft pull requests while you work. To see exactly what riders would see, give yourself
a private Telegram channel to post to:

1. **Make your own bot.** In Telegram, message **@BotFather** → `/newbot` → any name → a
   username ending in `bot` (e.g. `angel_blw_test_bot`). Keep the token it gives you private.
2. **Make a test channel.** New Channel → e.g. "BLW Test". Making it public with an obscure
   link (e.g. `t.me/blw_angel_test`) is easiest, because then its name works as the channel ID.
   For a private channel, open it at web.telegram.org: the number in the address bar
   (starting with `-100`) is the ID.
3. **Add your bot as an admin** of the channel, with only **Post Messages** turned on.
4. **Create your `.env` file** (git ignores it, so it never gets committed):

   ```bash
   cp .env.example .env
   ```

   Fill in your own values (Twilio can stay blank):

   ```
   ANTHROPIC_API_KEY=sk-ant-...       # your key from the bronx-line-watch workspace
   TELEGRAM_BOT_TOKEN=...             # your bot, not the production one
   TELEGRAM_CHANNEL_EN=@blw_angel_test
   STATE_FILE=data/dev-state.json
   ```

5. **Run it:**

   ```bash
   npm run dev
   ```

On its first run, `npm run dev` posts **every alert that's active right now**, so you see
output right away (a few Claude calls, a few cents). After that it posts only new ones,
checking every 60 seconds until you press Ctrl-C. To see them all again (after changing the
prompt, for example), delete your state file and rerun:

```bash
rm data/dev-state.json && npm run dev
```

Two guardrails: `npm run dev` **never sends text messages**, even if Twilio settings are in
your `.env`. And never put the production channels (`@bronxlinewatch`, `@bronxlinewatch_es`)
in your `.env`. Only the Render deployment posts there.

## Agents

Optional, for when you build agents: install the `ant` CLI (`brew install anthropics/tap/ant`)
and run `ant auth login`, choosing the **bronx-line-watch** workspace.

## Your daily habit: review the agents' pull requests

Most mornings the maintainer or the security guard will have opened something. For each one:

1. **Read the description.** Does the "why" make sense? Does it match the issue it claims to fix?
2. **Read the diff.** Would you have written it this way? Is anything changed that the issue didn't ask for?
3. **Check the tests.** Is there a new test that would have failed before the change? A fix without one is a guess.
4. **Watch for weakened checks.** An agent "fixing" a problem by loosening a test or the safety check is the classic failure.
5. **See how it got there.** In the Console → Managed Agents → Sessions, open the agent's run and scroll through what it ran and decided.
6. **Approve, or request changes with a comment.** The maintainer reads review comments on its next run and addresses them.

If something's wrong, the most valuable thing you can do is figure out **why** the agent got it
wrong and fix its instructions in `agents/<name>/agent.md`, not just the code.

## Your issues

Everything labeled [`Angel`](https://github.com/MollinBrett/bronx-line-watch/issues?q=is%3Aopen+label%3AAngel)
is reserved for you; the agents skip it. A good order:

1. **#4**: name the Spanish Telegram channel. A quick win only a native speaker can do well.
2. **#7**: rewrite the Spanish rubric. Writing down what "good Spanish" means is how you steer the model.
3. **#8, #9**: real-alert evals, then measure whether a cheaper model holds up.
4. **#23 by hand, then #29**: fix a security gap yourself, then build an agent that fixes the next one.
5. **#10, #11, #12, …**: build agents end to end.

Full list: [`docs/starter-issues.md`](starter-issues.md).

## How the agents work (read when you start #29 or #11)

- Each agent is a file: [`agents/maintainer/agent.md`](../agents/maintainer/agent.md). The
  frontmatter is its configuration (model, tools, permissions); the Markdown body is its
  instructions.
- `ant apply` syncs these files to Anthropic. `claude-lock.json` records what was created; commit it.
- `npm run schedule-agents` creates or updates their daily schedules. Run it after every
  `ant apply`, because schedules stay pinned to the agent version they were created with.
- Agents run in a sandbox with no secrets in it. Their GitHub token lives in an Anthropic vault and
  is added to requests outside the sandbox, so even a tricked agent can't leak it.
- Full setup and the permission choices: [`docs/agents.md`](agents.md).

## Ground rules

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) applies to you and the agents equally.
- `npm run eval` costs money (cents). `npm start` with Twilio set up texts real phones; don't run it locally.
- Never commit keys or real phone numbers. The security guard checks the whole history every day, and it will find them.
- After each issue you finish, write a few paragraphs on what you built and what surprised you.
  Those notes become the teaching series.

Questions: ask Brett, or open an issue. Welcome aboard.
