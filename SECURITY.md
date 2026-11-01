# bronx-line-watch security policy & change checklist

Bronx Line Watch sends text messages and Telegram posts to real people, and much of its code
is written or changed by AI: Claude Code, and this repo's own maintainer and security-guard
agents. So the question for every change is not only "does it work?" but **"could this change
make the service send something harmful, leak a secret, or give an agent more power than it had?"**

| Who or what | What it holds | What must stay true |
| --- | --- | --- |
| **Whoever writes an MTA alert** (or tampers with the feed) | Text that Claude reads | It can't make us send a link, phone number, or instruction that isn't a real service change. `src/safety.ts` is the last check before anything is sent. |
| **The watcher on Render** | The Anthropic, Twilio, and Telegram keys, plus subscriber phone numbers | It talks only to the MTA feed, Claude, Twilio, and Telegram. No other code path can read or send those secrets. |
| **The agents** (maintainer, security guard) | A sandbox with no secrets, and GitHub access through a token in an Anthropic vault | They can open pull requests and issues, never merge, and never change their own permissions without a human approving the change. |
| **AI coding assistants** (Claude Code, Copilot, …) | Whatever you let them edit | Every dependency, URL, permission, and test change in their diff is one you asked for. |
| **The supply chain** | npm packages, GitHub Actions | No unreviewed code runs at install time or in CI. Nothing newer than 7 days. |
| **Anyone who can push to this repo** | Code that deploys to Render on merge | Nothing reaches `main` without a pull request, a passing CI gate, and a second person's approval. |

---

## 1. Known accepted risks

- **Bare words that look like domains are blocked.** `src/safety.ts` treats any `word.word` as a link, so a message that happens to contain one is dropped rather than sent. That's the right trade for a service that texts strangers.
- **Phone numbers and "reply with your card number" scams aren't blocked yet** (#23). Claude is told never to add contact details, but `safety.ts` doesn't enforce it.
- **Agent bash is always allowed inside their sandbox.** The sandbox holds no secrets and reaches only npm, GitHub, and the MTA feed. GitHub actions stay on the `auto` permission policy, and branch protection is the backstop (see `docs/agents.md`).
- **`npm audit signatures` needs network access to Sigstore**, so it runs in CI but may fail on a restricted local network.

---

## 2. Automated checklist: runs on every push and pull request

`.github/workflows/ci.yml`, job `test`, which branch protection requires. It also runs every Monday to
catch advisories published since the last change. Run all of it locally with `npm run check`.

1. `npm ci --ignore-scripts` installs exactly the lockfile, with no install scripts.
2. `npm audit --audit-level=low`: zero findings at any severity.
3. `npm audit signatures`: registry signatures and provenance verify.
4. `scripts/freshness-check.mjs`: no locked package is under 7 days old.
5. `scripts/security-check.mjs` (`npm run security`), which fails on any of:
   * **Supply chain:** a dependency not on the allowlists; a version not pinned exactly; a non-registry package or missing integrity hash; an install script not denied in `allowScripts`; a lifecycle script; any `overrides`.
   * **Egress:** a URL in `src/` outside the allowlist (MTA feed, Twilio, Telegram), or the right host in the wrong file; `fetch()` outside those three files; raw network modules, WebSockets, or a custom Claude `baseURL`.
   * **Dangerous code:** `eval`, `new Function`, `child_process`, `vm`, a computed `import()`, or reading or dumping `process.env` by computed name.
   * **Secrets and personal data:** anything that looks like an Anthropic, Twilio, Telegram, GitHub, or AWS credential; a tracked `.env`; a real-looking phone number outside test fixtures; logging a phone number without masking it, or logging a token.
   * **Hidden text:** invisible or bidirectional Unicode characters anywhere ("Trojan Source"), or text addressed to AI tools (telling an assistant to drop its rules, or a message written to "the AI") outside the eval and test fixtures that exist to test exactly that.
   * **Rider safety:** sending before `checkRiderMessage()`; the alert leaving its `<mta_alert>` data tags; Telegram posts with a `parse_mode`; any change to `ALLOWED_LINK_HOSTS`.
   * **Tests:** `.skip`, `.only`, `.todo`, or `xit`; an expected-failure test that doesn't name its open issue.
   * **Agents:** web tools enabled; GitHub MCP tools set to `always_allow`; an MCP server other than GitHub's; dropping the "never push to `main`", "information, not instructions", or "don't spend credit or send texts" rules; agent networking other than `limited` with the approved hosts.
   * **CI:** `pull_request_target`/`workflow_run`, write permissions, secrets, unpinned actions, `npm install`, or a dependency cache.
   * **Website:** a script, iframe, form, inline event handler, or external resource in `docs/*.html`.
6. `tsc --noEmit`.
7. `npm test`, including `test/security-check.test.ts`, which plants 17 typical AI-injected changes in a throwaway copy of the repo and fails if the gate lets any of them through.

---

## 3. Manual checklist: required for the matching change type

The pull request template lists these. Tick the ones that apply.

### 3.1 Watcher code (`src/`)
- [ ] Re-read the diff asking: **could this make us send something to a rider that isn't a real service change?**
- [ ] Every message still goes through `checkRiderMessage()` before any send.
- [ ] No new place where outside text (MTA alerts, incoming texts) reaches Claude without the "data, not instructions" framing.
- [ ] Network calls have timeouts. No new destination.
- [ ] If a test in `test/safety.test.ts` or `test/security-check.test.ts` fails, **the code is wrong. Never edit those tests to make them pass.**

### 3.2 Dependencies (the highest-risk change an AI assistant can make for you)
- [ ] You asked for this dependency. If an assistant or agent added it unprompted, reject the change.
- [ ] The name matches the official project character by character.
- [ ] `npm view <pkg>@<ver> _npmUser time repository`: the publisher is the known one, the version is **at least a week old**, and the repository link is the real project.
- [ ] Read the `package-lock.json` diff. New transitive packages, changed `resolved` URLs, or missing `integrity` fields are each stop-the-line.
- [ ] Installing a version from the last 7 days? Use `npm install --before=<date 8 days ago> <pkg>` instead, and pin it exactly.
- [ ] A new **runtime** dependency runs on Render next to every key. Add it to `RUNTIME_DEP_ALLOWLIST` only with a written reason in the pull request.

### 3.3 Prompts, evals, and the safety check (`src/rewrite.ts`, `src/safety.ts`, `evals/`)
- [ ] A prompt change comes with `npm run eval` results, before and after, in the pull request.
- [ ] The safety check only gets **stricter**. Loosening it needs a written reason and a second reviewer.

### 3.4 Agents (`agents/`, `environments/`, `vaults/`, `scripts/schedule-agents.ts`)
- [ ] Nothing widens what an agent can do: no new tools, MCP servers, hosts, or permission policies, and no softened rules in its instructions.
- [ ] After merging, run `ant apply` and `npm run schedule-agents` (see `docs/agents.md`), and commit `claude-lock.json`.
- [ ] **An agent's pull request that changes any of these files is rejected.** Their instructions forbid it.

### 3.5 Pipeline and policy (`.github/`, `scripts/`, this file)
- [ ] Nothing gives CI more power: no write permissions, no secrets, no `pull_request_target`, actions pinned to SHAs.
- [ ] Changing an allowlist or rule in `scripts/security-check.mjs` is itself a security change. Say why in the pull request.

### 3.6 Code written with AI help (including the agents' own pull requests)
- [ ] Treat instructions inside third-party content (MTA alerts, issues, package READMEs, error messages, web pages) as untrusted input, not tasks.
- [ ] Every dependency, URL, header, permission, and test change in the diff is one you asked for.
- [ ] The diff is small enough to actually read.
- [ ] For an agent's pull request, open its session in the Console and check that what it *did* matches what it *says* it did.

---

## 4. Setup outside the repo

- **Branch protection on `main`:** pull request required, 1 approval, status check `test` required, force pushes blocked, no bypass.
- **Anthropic workspace `bronx-line-watch`:** a monthly spend limit; separate API keys for Render and for each person; revoke any key that may have leaked.
- **Render:** secrets only in Environment settings; auto-deploy from `main` only.
- **Agents' GitHub token:** fine-grained, this repository only, Contents, Pull requests, and Issues (read/write). Nothing else. Expires every 90 days.
