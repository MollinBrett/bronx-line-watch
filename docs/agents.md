# The agent team

Two Claude Managed Agents keep this repo healthy. They run in Anthropic-hosted sandboxes
on a schedule, check out the repo, and open pull requests and issues. **They never merge.**

| Agent | Schedule (New York time) | Spend cap per run | Does |
|---|---|---|---|
| `agents/maintainer` | daily 4:15 AM | $5 | Fixes failing tests, feed-format changes, outdated packages, `agent-ok` issues |
| `agents/security-guard` | daily 5:45 AM | $3 | `npm audit`, secret leaks, prompt-injection tests, unsafe code; files `security` issues |

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

### 3. Install the CLI and create the resources
Install `ant` 1.34.0 or later (https://github.com/anthropics/anthropic-cli/releases) and run `ant auth login`. Then, from the repo root:

```bash
ant apply --dry-run -v agents/maintainer/agent.md agents/security-guard/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

Check that the plan shows exactly two agents, one environment and one vault, then run it for real:

```bash
ant apply agents/maintainer/agent.md agents/security-guard/agent.md environments/agent-sandbox.yaml vaults/github.yaml
```

### 4. Put the token in the vault
The agents reach GitHub's MCP server with this token. Anthropic stores it and injects it outside the sandbox, so the agents can use it but never read it. Run these one block at a time; paste the token at the silent prompt.

```bash
read -rs CMA_GITHUB_REPO_TOKEN && export CMA_GITHUB_REPO_TOKEN
```

```bash
VAULT_ID=$(jq -r '.resources["./vaults/github.yaml"].id' claude-lock.json)
jq -n -f /dev/stdin <<'JQ' | ant beta:vaults:credentials create --vault-id "$VAULT_ID"
{
  display_name: "GitHub MCP",
  auth: {
    type: "static_bearer",
    mcp_server_url: "https://api.githubcopilot.com/mcp/",
    token: (env.CMA_GITHUB_REPO_TOKEN // error("CMA_GITHUB_REPO_TOKEN is not set"))
  }
}
JQ
```

### 5. Create the schedules (paused), test, then start them
In the same terminal (the token is still in `CMA_GITHUB_REPO_TOKEN`):

```bash
npm run schedule-agents
```

```bash
unset CMA_GITHUB_REPO_TOKEN
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

## Known gap: approvals nobody answers
Tool calls run under the `auto` permission policy: the server runs what it judges safe and
blocks what it judges high-risk. When it can't decide, the session **pauses for a human**, and
since nobody is watching a scheduled run, it waits until the next day's run replaces it.
Fixing that (a webhook that notifies you or answers the pause) is a starter issue.
