## What and why

## Checklist (SECURITY.md section 3)
<!-- Tick EVERY box. If an area doesn't apply, tick it anyway and start the note with "N/A:" and a reason.
     CI checks that every box is ticked, and that areas this PR touches aren't marked N/A. -->
- [ ] **Watcher code (`src/`):** every message still goes through `checkRiderMessage()`; no new network destination; safety tests not edited to pass
- [ ] **Dependencies:** I asked for it, the name is exact, the version is at least a week old, and I read the lockfile diff
- [ ] **Prompt or safety check:** `npm run eval` before/after results are below; the safety check got stricter, not looser
- [ ] **Agents:** nothing widens what an agent can do; after merging, run `ant apply` and `npm run schedule-agents`
- [ ] **CI, scripts, or security rules:** the reason for changing a rule or allowlist is explained below
- [ ] **Written with AI help:** every dependency, URL, permission and test change in this diff is one I asked for
