# The agent team

Three Claude Managed Agents keep this repo healthy. They run in Anthropic-hosted sandboxes
on a schedule and check out the repo. Two open pull requests and issues; the third reviews
every pull request. **They never merge, and none of them can approve.**

| Agent | Schedule (New York time) | Spend cap per run | Does |
|---|---|---|---|
| `agents/maintainer` | daily 4:15 AM | $5 | Fixes failing tests, feed-format changes, outdated packages, `agent-ok` issues |
| `agents/security-guard` | daily 5:45 AM | $3 | `npm audit`, secret leaks, prompt-injection tests, unsafe code; files `security` issues |
| `agents/code-reviewer` | daily 6:30 AM, 12:30 PM, 6:30 PM | $3 | Reviews every open pull request, including the other agents', and leaves a comment review with a verdict |

Agent definitions are version-controlled files synced with the `ant` CLI. Edit a file and
re-run `ant apply` to update an agent; the IDs live in `claude-lock.json` (commit it).

## One-time setup

### 1. Protect `main` (this is the real safety net)
GitHub -> Settings -> Branches -> add a rule for `main`:
- Require a pull request before merging, with **1 approval**
- Require status checks to pass: `test`
- **Do not allow bypassing the above settings** (otherwise your admin rights flow through to the agents' token)

The agents' PRs are opened with your token, so they show up as authored by you and GitHub won't
let you approve them yourself. Your co-maintainer reviews agent PRs - which is the point.
(Later you can give the agents their own GitHub account instead.)

### 2. Create a GitHub token for the agents
GitHub -> Settings -> Developer settings -> Fine-grained tokens -> new token:
- Repository access: **only** `bronx-line-watch`
- Permissions: Contents (read/write), Pull requests (read/write), Issues (read/write). Nothing else - no Workflows, no Administration.
- Expiration: 90 days (put a reminder on your calendar).

### 3. Create the agents, sandbox, and vault
Already done (IDs are in `claude-lock.json`). To change an agent later, edit its file and run,
from the repo root, with the `ant` CLI logged in to the bronx-line-watch workspace:

```bash
ant apply --dry-run -v agents/maintainer/agent.md agents/security-guard/agent.md agents/code-reviewer/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

```bash
ant apply agents/maintainer/agent.md agents/security-guard/agent.md agents/code-reviewer/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

Then **point the schedules at the new version** - each schedule is pinned to the agent version
that existed when it was created or last updated:

```bash
npm run schedule-agents
```

Commit the updated `claude-lock.json` in a pull request.

### 4. Put the GitHub token in the vault (Console, no terminal)
The agents reach GitHub only through GitHub's MCP server, using the token from step 2. Anthropic
stores it and adds it to requests outside the sandbox, so the agents can use it but never read it.
The repo itself is public, so each agent clones it at the start of a run without a token.

In the Claude Console (bronx-line-watch workspace) -> **Managed Agents -> Vaults ->
bronx-line-watch-github -> Add credential**:
- Type: **MCP server**, static bearer token
- MCP server URL: `https://api.githubcopilot.com/mcp/` (exactly, with the trailing slash)
- Token: the fine-grained GitHub token

### 5. Create the schedules (paused), test, then start them
From the repo root, logged in with `ant` (or with `ANTHROPIC_API_KEY` for this workspace):

```bash
npm run schedule-agents
```

Try one run by hand and watch it in the Console (the command prints the link):

```bash
npm run schedule-agents -- --run maintainer
```

Happy with it? Start the schedules:

```bash
npm run schedule-agents -- --unpause
```

## Knowing what the agents did
- Every run is a session in the Console (platform.claude.com -> Managed Agents -> Sessions).
- Their work shows up as PRs from `maintainer/*` and `security/*` branches and issues labeled `security`.
- The code reviewer's work shows up as a review on each pull request that starts with
  "**Code reviewer** - reviewed at" and a commit SHA. It posts with your token, so GitHub shows you as the author.

## The code reviewer

**What triggers it.** A schedule, three times a day, plus `npm run schedule-agents -- --run code-reviewer`
when you want a review now. Each run it lists the open pull requests and reviews the ones that
have no review of its own at their current head commit (at most 2 per run, newest first), so a
new push gets a fresh review and an unchanged pull request is never reviewed twice.

A GitHub Action that starts a run on every pull request would be faster, but it needs an
Anthropic API key stored in CI, and a pull request can edit the workflow that reads it.
SECURITY.md section 2 allows no secrets in CI, so the reviewer polls instead. The cost is a
wait of up to six hours during the day, and overnight.

**How it reviews.** It borrows the method of formal verification, without the proof tools:
1. Write down what each changed function must guarantee (its *contract*: what it needs from
   callers, what it promises back).
2. Check every path through the code against that contract, including errors and timeouts, and
   check that loops and retries must stop.
3. Check the project's *invariants*, the things that must stay true across every change. They
   are listed as I1-I8 in `agents/code-reviewer/agent.md` and come from SECURITY.md: every
   message passes the safety check, the safety check only gets stricter, an alert is announced
   once, agents and CI gain no power, and so on.
4. Try to break it: run boundary inputs, and for pure functions enumerate every combination of
   a few small inputs. A problem is reported as a blocker only with a counterexample it ran.

Every conclusion carries one of three labels: **proved by argument**, **checked by execution**
(over the inputs listed, so bounded), or **not checked**. This is careful reasoning plus bounded
testing. It is not a machine-checked proof, and the review says what it did not check.

**Approve vs. comment.** It always comments and never approves. Its reviews are posted with your
token, so an approval from it would count as the one human approval branch protection requires,
on any pull request you did not open yourself. Instead each review carries a verdict:
- **Changes needed:** a check fails, an invariant breaks, there is a confirmed counterexample,
  a behavior change has no test, or the description leaves out part of the diff.
- **Ready for a human reviewer:** it found none of those. That is not "merge it".

That rule is text in a prompt, so the tool config backs it up: every GitHub tool is switched
off for the reviewer except the four it needs to read pull requests and write reviews. It has
no tool to merge, push, create a branch, or open an issue. The one gap the config cannot close
is that the review tool itself accepts an "approve" event. An approval alone merges nothing,
and a separate GitHub account for the agents that is not allowed to approve would close it.

For a pull request from a fork it runs no code at all and reviews by reading.

`npm run security` fails if the "never approve" rule is removed or a GitHub tool is added.

**When to trust it.** Trust a blocker that comes with a counterexample: run it yourself and
watch it fail. Treat "ready for a human reviewer" as "the obvious things were checked", then read the
"Not checked" list, which is where your own review should start. For an agent's pull request,
still open the session in the Console and compare what it did with what it says it did.

## Permissions
- **Shell commands (`bash`) are always allowed.** The sandbox holds no secrets (the GitHub token
  lives in the vault and is added outside the sandbox) and its network only reaches npm, GitHub,
  and the MTA feed. Under `auto`, the server refused `npm ci`, so the maintainer couldn't run tests.
- **Everything else, including all GitHub actions, is `auto`:** the server runs what it judges safe
  and blocks what it judges high-risk. Branch protection means nothing reaches `main` unreviewed.

## Known gap: approvals nobody answers
Under `auto`, some calls can't be judged either way. When it can't decide, the session **pauses for a human**, and
since nobody is watching a scheduled run, it waits until the next day's run replaces it.
Fixing that (a webhook that notifies you or answers the pause) is a starter issue.
