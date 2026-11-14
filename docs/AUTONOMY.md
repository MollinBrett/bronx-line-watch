# Toward a self-running project, safely

The goal: over time, agents review pull requests, merge them, and ship to production with
less and less human involvement. We get there **gradually**, and only as fast as two things
allow:

1. **We can write down how decisions are made.** Each time a person does something
   repeatedly, we capture the decision as rules and rubrics, and then hand it to an agent or
   a script.
2. **The worst case stays small.** This isn't critical infrastructure. If something goes
   wrong, shutting the service down is always better than letting it do damage or run up a
   bill.

## 1. Turn reviews into rules

When Brett reviews a pull request, he isn't reading every word. He's checking that **nothing
was slipped in**: no surprise dependency, no new network destination, no weakened test,
nothing outside what the pull request says it does. That kind of review can be written down.

The loop:

1. **Notice where people spend time.** Keep a short running note of what you reviewed, what
   you actually checked, and how long it took.
2. **Write the decision down.** Split each check into:
   - **mechanical rules** that code can enforce, which go into `scripts/security-check.mjs` or
     `scripts/pr-checklist.mjs`, with a test that plants the bad change; and
   - **judgment calls** that need a model, which go into the review rubric
     (`docs/REVIEW-RUBRIC.md`) that the code-reviewer agent (#12) grades against. Started in #58.
3. **Run the agent in the shadow first.** It reviews alongside a person, and we compare the
   two. When they agree consistently, the agent can take over that kind of review.
4. **Repeat** with the next most time-consuming task.

## 2. The autonomy ladder

Each kind of change moves up one rung at a time, only after a track record at the rung
below. Anything touching rider safety, secrets, agents or CI stays near the bottom longest.

| Rung | Who approves and merges | Example |
|---|---|---|
| 0 | A person reviews every line | Today, for everything |
| 1 | A person approves after the reviewer agent's summary | Most changes, once #12 exists |
| 2 | Agent approves; a person can veto within a time window | Test-only changes; docs |
| 3 | Agent approves and merges; a person is told after | Dependency patches that pass the 7-day rule and every check |
| 4 | Fully automatic, including deploy | Only changes whose worst case is already capped (section 3) |

The first step up is #59: automatic merges for test-only pull requests.

To move a kind of change up a rung, we want: a written rubric for it, a period of the agent
agreeing with human reviews, and no incidents from that kind of change.

**Never automated:** changes to the safety check's allowlist, to agent permissions, to CI or
the security rules, and anything that adds a dependency. Those always get a person.

## 3. Limit the worst case

For each thing that could go wrong, there's a hard limit that holds even if every agent,
every check, and every person fails at the same time.

| What could go wrong | Worst case today | The hard limit |
|---|---|---|
| A bug or loop calls Claude nonstop | Charges until someone notices | **Anthropic workspace spend limit** (hard cap, #54), plus per-run budgets on each agent ($5 / $3) |
| A bug texts every subscriber over and over (#40) | Twilio charges per segment, with no ceiling | **Twilio: auto-recharge off, small prepaid balance**, usage alerts (#54); in-app caps on texts per hour and per day (#56) |
| A bad or tricked message reaches riders | Scam link in a text or a public Telegram post | The safety check, plus **automatic pause** when anything looks off |
| A leaked key | Someone else spends on our accounts | Separate keys per place, spend limits, revoke in a minute |
| A bad merge goes live | Auto-deploys to Render | Branch protection, CI gate, and the kill switch |
| An agent misbehaves | Opens bad pull requests or issues | Its GitHub token only covers this repo and can't merge; its per-run budget |

### The kill switch

Like the hosting companies that used to just turn a hacked site off: **when in doubt, stop.**

- **In the app:** a `PAUSED` setting stops all sending, and the app also **pauses itself**
  when it hits a limit (too many texts or Claude calls in an hour, too many safety blocks in a
  row) and sends an alert to a private Telegram channel. Turning it back on is a human decision. (#56)
- **A guardian:** a watchdog agent or script that can only **stop** things (pause the
  watcher, pause the agents' schedules, alert people) and never start, deploy, or change code. (#57)
  Stop-only powers mean that if the guardian itself is wrong, the worst it can do is a
  temporary outage.
- **By hand, in five minutes,** see below.

### Shut everything down by hand

1. **Render:** open the bronx-line-watch service and choose **Suspend**. Sending stops immediately.
2. **Agents:** in the Claude Console, open **Managed Agents → Deployments** and pause both.
3. **Keys, if a leak is possible:** revoke the Anthropic key (Console → API Keys), regenerate the
   Telegram bot token (@BotFather → `/revoke`), and rotate the Twilio auth token. Then put the
   new values in Render.
4. **GitHub:** if the agents' token may be involved, delete it (Settings → Developer settings).

Practice this once (#55), so it's quick when it matters.
