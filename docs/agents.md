# The agent team

Two Claude Managed Agents keep this repo healthy. They run in Anthropic-hosted sandboxes
on a schedule, check out the repo, and open pull requests and issues. **They cannot merge:** no tool that
merges is switched on for them (see [Permissions](#permissions)).

| Agent | Schedule (New York time) | Spend cap per run | Does |
|---|---|---|---|
| `agents/maintainer` | daily 4:15 AM | $5 | Fixes failing tests, feed-format changes, outdated packages, `agent-ok` issues |
| `agents/security-guard` | daily 5:45 AM | $3 | `npm audit`, secret leaks, prompt-injection tests, unsafe code; files `security` issues |

Agent definitions are version-controlled files synced with the `ant` CLI. Edit a file and
re-run `ant apply` to update an agent; the IDs live in `claude-lock.json` (commit it).

## One-time setup

### 1. Protect `main`
GitHub -> Settings -> Rules -> Rulesets -> the ruleset for `main`:
- Require a pull request before merging, with **0 approvals**
- Require status checks to pass: `test`
- Block force pushes
- **No bypass list** (otherwise your admin rights flow through to the agents' token)

The agents' PRs are opened with your token, so they show up as authored by you, and GitHub won't
let you approve your own pull requests. That is why no approval is required. What keeps an agent
from merging is not this ruleset: with 0 approvals the agents' token could merge any pull request
whose CI is green. It is that the agents have no merge tool (see [Permissions](#permissions)).
The ruleset still does two jobs: it refuses a direct push to `main`, and it makes `test` pass first.
(Later you can give the agents their own GitHub account instead.)

### 2. Create a GitHub token for the agents
GitHub -> Settings -> Developer settings -> Fine-grained tokens -> new token:
- Repository access: **only** `bronx-line-watch`
- Permissions: Contents (read/write), Pull requests (read/write), Issues (read/write). Nothing else - no Workflows, no Administration.
- This token is able to merge a pull request (Contents write is all GitHub asks for). The agents can't use it that way because they have no merge tool, and they never see the token itself (step 4).
- Expiration: 90 days (put a reminder on your calendar).

### 3. Create the agents, sandbox, and vault
Already done (IDs are in `claude-lock.json`). To change an agent later, edit its file and run,
from the repo root, with the `ant` CLI logged in to the bronx-line-watch workspace:

```bash
ant apply --dry-run -v agents/maintainer/agent.md agents/security-guard/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

```bash
ant apply agents/maintainer/agent.md agents/security-guard/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

Then **point the schedules at the new version** - each schedule is pinned to the agent version
that existed when it was created or last updated. Until you do, the scheduled runs keep the old
version's tools, whatever the file in the repo says:

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

## Permissions
- **Shell commands (`bash`) are always allowed.** The sandbox holds no secrets (the GitHub token
  lives in the vault and is added outside the sandbox) and its network only reaches npm, GitHub,
  and the MTA feed. Under `auto`, the server refused `npm ci`, so the maintainer couldn't run tests.
- **GitHub tools are off unless named.** Each agent file switches GitHub's toolset off
  (`default_config: {enabled: false}`) and then switches on 17 tools by name: reading files, commits,
  branches, issues and pull requests; creating a branch; pushing files to it; opening and editing a
  pull request; creating, editing, labelling and commenting on issues. Nothing that merges or approves
  a pull request, deletes a file, branch or repository, changes a repository setting, or touches
  workflows or releases is on the list, so an agent cannot do those things whatever its instructions,
  an issue, or the feed says. `scripts/security-check.mjs` holds the list (`GITHUB_TOOL_ALLOWLIST`)
  and CI fails if an agent file strays from it. Tool names are GitHub's, from the
  [github-mcp-server README](https://github.com/github/github-mcp-server#tools); a name GitHub
  renames stops working silently, so if an agent suddenly can't open pull requests, check there first.
- **The tools that stay on are `auto`:** the server runs what it judges safe and blocks what it judges
  high-risk.
- **What the agents can still do:** push to any branch except `main`, including the branch of a pull
  request someone else opened, and edit or close any issue or pull request. Read the whole diff before
  you merge.

## Known gap: approvals nobody answers
Under `auto`, some calls can't be judged either way. When it can't decide, the session **pauses for a human**, and
since nobody is watching a scheduled run, it waits until the next day's run replaces it.
Fixing that (a webhook that notifies you or answers the pause) is a starter issue.
