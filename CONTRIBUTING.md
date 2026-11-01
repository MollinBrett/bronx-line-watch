# Contributing

Humans and agents follow the same rules here.

## Workflow
- Branch from `main`, open a pull request, get one approving review, merge. Nobody pushes to `main` directly - not people, not agents.
- Agent branches are prefixed: `maintainer/...`, `security/...`.
- `npm run typecheck` and `npm test` must pass (CI checks both).

## Code
- TypeScript, ES modules, Node 22+. Keep dependencies to a minimum - every package is someone else's code running with our secrets.
- Every behavior change comes with a test. Tests never call real APIs; mock the Claude client like `test/rewrite.test.ts` does.
- Network calls always have a timeout.
- Never log secrets or full phone numbers.

## Things that cost money or reach people
- `npm run eval` calls Claude (roughly $0.05-0.15 per run today). Run it when you change the prompt, model, or effort, and paste the before/after pass rate in your PR.
- `npm start` with Twilio configured texts real phones.

## Issue labels
- `mentee` - reserved for a person to learn from. Agents skip these.
- `agent-ok` - small and clearly specified; the maintainer agent may pick it up.
- `security` - filed by the security guard or anyone else.
