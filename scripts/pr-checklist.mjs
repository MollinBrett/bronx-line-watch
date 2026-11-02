#!/usr/bin/env node
// Checks a pull request's SECURITY.md checklist (see .github/pull_request_template.md):
// every item is ticked, and an item may only say "N/A" when the PR doesn't touch that area.
// An unticked box is ambiguous ("doesn't apply" or "forgot?"), so it fails.
//
//   PR_BODY="..." CHANGED_FILES="$(git diff --name-only main...HEAD)" node scripts/pr-checklist.mjs
//
// In CI the body arrives through an environment variable, never interpolated into the
// shell command, so text in a PR description can't run as code.

export const ITEMS = [
  { label: "Watcher code", touches: (f) => f.startsWith("src/") },
  { label: "Dependencies", touches: (f) => f === "package.json" || f === "package-lock.json" || f === ".npmrc" },
  { label: "Prompt or safety check", touches: (f) => ["src/rewrite.ts", "src/safety.ts"].includes(f) || f.startsWith("evals/") },
  { label: "Agents", touches: (f) => /^(agents|environments|vaults)\//.test(f) || f === "scripts/schedule-agents.ts" || f === "claude-lock.json" },
  { label: "CI, scripts, or security rules", touches: (f) => f.startsWith(".github/") || f.startsWith("scripts/") || f === "SECURITY.md" },
  { label: "Written with AI help", touches: () => false },
];

export function checkChecklist(body, changedFiles) {
  const problems = [];
  const text = String(body || "").replace(/<!--[\s\S]*?-->/g, "");
  for (const item of ITEMS) {
    const line = text.split("\n").find((l) => l.includes(`**${item.label}`));
    if (!line) {
      problems.push(`"${item.label}" is missing from the checklist. Copy it from .github/pull_request_template.md`);
      continue;
    }
    if (!/^\s*[-*]\s*\[[xX]\]/.test(line)) {
      problems.push(`"${item.label}" isn't ticked. Tick it; if it doesn't apply, write "N/A:" and a reason`);
      continue;
    }
    const na = /\*\*\s*:?\s*N\/?A\b|:\*\*\s*N\/?A\b/i.test(line);
    const touched = changedFiles.filter(item.touches);
    if (na && touched.length) {
      problems.push(`"${item.label}" says N/A, but this PR changes ${touched.slice(0, 3).join(", ")}${touched.length > 3 ? ", ..." : ""}`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changed = String(process.env.CHANGED_FILES || "").split("\n").map((f) => f.trim()).filter(Boolean);
  const problems = checkChecklist(process.env.PR_BODY, changed);
  if (problems.length) {
    console.error(`pr-checklist: ${problems.length} problem(s) in the PR description\n` + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
  console.log(`pr-checklist: all ${ITEMS.length} items ticked; N/A only where the PR (${changed.length} files) doesn't touch that area`);
}
