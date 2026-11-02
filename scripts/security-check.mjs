#!/usr/bin/env node
// Static security gate. Runs in CI on every push and pull request, and locally
// with `npm run security`. Each check is a rule from SECURITY.md section 2 that a
// change - especially one written by an AI assistant or by this repo's own
// agents - could quietly break. Exit code 1 lists every broken rule.
//
// Changing an allowlist in this file is itself a security change: say why in
// the pull request (SECURITY.md 3.5).

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const failures = [];
const fail = (rule, msg) => failures.push(`[${rule}] ${msg}`);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
} catch {
  fail("setup", "not a git checkout; run inside the repo");
}
const srcFiles = tracked.filter((f) => f.startsWith("src/") && f.endsWith(".ts"));
const testFiles = tracked.filter((f) => f.startsWith("test/") && f.endsWith(".ts"));
const textFiles = tracked.filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?)$/.test(f));
if (!srcFiles.length) fail("setup", "no tracked src/*.ts files found");

// --- 1. Supply chain -----------------------------------------------------------
// Every runtime dependency runs on Render with the Anthropic, Twilio and Telegram
// keys in its environment. Adding one is reviewed per SECURITY.md 3.2.
const RUNTIME_DEP_ALLOWLIST = {
  "@anthropic-ai/sdk": "Claude API client",
  zod: "validates the MTA feed and Claude's structured output",
  tsx: "runs the TypeScript entry point on Render",
};
const DEV_DEP_ALLOWLIST = ["@types/node", "typescript", "vitest"];
{
  const pkg = JSON.parse(read("package.json"));
  for (const d of Object.keys(pkg.dependencies || {})) {
    if (!(d in RUNTIME_DEP_ALLOWLIST)) fail("supply-chain", `runtime dependency "${d}" is not on RUNTIME_DEP_ALLOWLIST in scripts/security-check.mjs`);
  }
  for (const d of Object.keys(pkg.devDependencies || {})) {
    if (!DEV_DEP_ALLOWLIST.includes(d)) fail("supply-chain", `dev dependency "${d}" is not on DEV_DEP_ALLOWLIST in scripts/security-check.mjs`);
  }
  for (const [d, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!/^\d+\.\d+\.\d+$/.test(v)) fail("supply-chain", `${d} must be pinned to an exact version, found "${v}"`);
  }
  for (const k of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]) {
    if (pkg.scripts?.[k]) fail("supply-chain", `package.json must not define a "${k}" lifecycle script`);
  }
  if (pkg.overrides && Object.keys(pkg.overrides).length) {
    fail("supply-chain", "package.json overrides swap packages deep in the tree; none are approved (SECURITY.md 3.2)");
  }
  const approved = pkg.allowScripts || {};
  const lock = JSON.parse(read("package-lock.json"));
  for (const [key, p] of Object.entries(lock.packages || {})) {
    if (!key || p.link) continue;
    const name = key.replace(/^.*node_modules\//, "");
    if (!String(p.resolved || "").startsWith("https://registry.npmjs.org/")) fail("supply-chain", `${key} resolves outside registry.npmjs.org: ${p.resolved}`);
    if (!/^sha512-/.test(p.integrity || "")) fail("supply-chain", `${key} has no sha512 integrity hash`);
    if (p.hasInstallScript && approved[name] !== false) {
      fail("supply-chain", `${name} ships an install script that hasn't been reviewed; add it to package.json allowScripts as false`);
    }
  }
  for (const [name, ok] of Object.entries(approved)) {
    if (ok !== false) fail("supply-chain", `allowScripts.${name} is enabled; install scripts are denied by policy`);
  }
  const npmrc = existsSync(path.join(root, ".npmrc")) ? read(".npmrc") : "";
  if (!/^save-exact=true$/m.test(npmrc)) fail("supply-chain", ".npmrc must set save-exact=true");
}

// --- 2. Network egress: only the services this app talks to -----------------------
// An injected "telemetry" call or a URL swapped for a lookalike is the classic way to
// leak the keys on Render. Every URL in src/ must be on this list.
const EGRESS_ALLOWLIST = {
  "api-endpoint.mta.info": "src/mta.ts",
  "api.twilio.com": "src/sms.ts",
  "api.telegram.org": "src/telegram.ts",
};
const TEXT_ONLY_HOSTS = ["mta.info", "new.mta.info"]; // allowed in rider text, never fetched
for (const f of srcFiles) {
  const code = stripComments(read(f));
  for (const m of code.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)) {
    const host = m[1].toLowerCase();
    if (EGRESS_ALLOWLIST[host]) {
      if (EGRESS_ALLOWLIST[host] !== f) fail("egress", `${f} references ${host}; only ${EGRESS_ALLOWLIST[host]} may`);
    } else if (!TEXT_ONLY_HOSTS.includes(host)) {
      fail("egress", `${f} references ${host}, which is not on EGRESS_ALLOWLIST`);
    }
  }
  const usesFetch = /\bfetch\s*\(/.test(code);
  if (usesFetch && !Object.values(EGRESS_ALLOWLIST).includes(f)) fail("egress", `${f} calls fetch(); only ${Object.values(EGRESS_ALLOWLIST).join(", ")} may`);
  for (const [re, what] of [
    [/from\s+["']node:(net|tls|dgram|http2?|https)["']|require\(\s*["'](node:)?(net|tls|dgram|http2?|https)["']/, "a raw network module"],
    [/new\s+WebSocket\b|\bEventSource\b/, "a WebSocket/EventSource"],
    [/baseURL\s*:/, "a custom API base URL (could redirect Claude calls and the API key)"],
  ]) if (re.test(code)) fail("egress", `${f} uses ${what}`);
}

// --- 3. Dangerous code ---------------------------------------------------------------
for (const f of [...srcFiles, ...tracked.filter((f) => /^(scripts|evals)\/.+\.(ts|mjs|js)$/.test(f))]) {
  if (f === "scripts/security-check.mjs") continue;
  const code = stripComments(read(f));
  for (const [re, what] of [
    [/\beval\s*\(/, "eval("],
    [/new\s+Function\s*\(/, "new Function("],
    [/from\s+["']node:(child_process|vm|worker_threads)["']|require\(\s*["'](node:)?(child_process|vm)["']/, "child_process/vm (runs arbitrary commands or code)"],
    [/\bimport\s*\(\s*(?!["'])/, "a dynamic import of a computed path"],
    [/JSON\.stringify\(\s*process\.env|Object\.(keys|values|entries)\(\s*process\.env|\.\.\.process\.env/, "a dump of process.env (every secret at once)"],
    [/process\.env\[(?!\s*["'])/, "process.env read with a computed name"],
  ]) if (re.test(code)) fail("code", `${f} contains ${what}`);
}

// --- 4. Secrets and personal data ------------------------------------------------------
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic API key"],
  [/\bsk-[A-Za-z0-9]{40,}/, "an API secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, "a GitHub token"],
  [/\bAC[0-9a-f]{32}\b/, "a Twilio Account SID"],
  [/\bSK[0-9a-f]{32}\b/, "a Twilio API key"],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, "a Telegram bot token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
];
// Real-looking US phone numbers. 555-01xx numbers are reserved for fiction; the
// service's own public number is allowed.
const PUBLIC_NUMBERS = ["8885276698"];
for (const f of textFiles) {
  if (f === "package-lock.json" || f === "scripts/security-check.mjs") continue;
  if (/(^|\/)\.env(\..+)?$/.test(f) && f !== ".env.example") fail("secrets", `${f} is tracked; .env files must stay git-ignored`);
  const s = read(f);
  for (const [re, what] of SECRET_PATTERNS) if (re.test(s)) fail("secrets", `${f} appears to contain ${what}`);
  if (f.startsWith("test/fixtures/")) continue;
  for (const m of s.matchAll(/\+1\d{10}\b/g)) {
    const n = m[0].slice(2);
    if (!PUBLIC_NUMBERS.includes(n) && !/^\d{3}55501\d{2}$/.test(n)) fail("pii", `${f} contains a real-looking phone number ${m[0].slice(0, 6)}...; use a 555-01xx number`);
  }
}
{
  const gi = read(".gitignore");
  for (const need of [".env", "node_modules", "data/state.json"]) if (!gi.includes(need)) fail("secrets", `.gitignore must cover ${need}`);
}
for (const f of srcFiles) {
  const code = stripComments(read(f));
  for (const line of code.split("\n")) {
    if (/console\.(log|info|warn|error|debug)/.test(line) && /\.phone\b/.test(line) && !/\.phone\.slice\(\s*0\s*,\s*-4\s*\)/.test(line)) {
      fail("pii", `${f} logs a phone number without masking it: ${line.trim().slice(0, 80)}`);
    }
    if (/console\.(log|info|warn|error|debug)\([^)]*(TOKEN|API_KEY|AUTH|botToken|authToken|apiKey)/.test(line)) {
      fail("secrets", `${f} may log a secret: ${line.trim().slice(0, 80)}`);
    }
  }
}

// --- 5. Hidden text and instructions aimed at AI tools --------------------------------
// Invisible or bidirectional characters can make code read differently than it runs
// ("Trojan Source"), and comments addressed to AI assistants are prompt injection
// waiting for the next agent that reads this repo.
const INJECTION_FIXTURES = ["evals/cases.ts", "test/safety.test.ts", "scripts/security-check.mjs"];
for (const f of textFiles) {
  const s = read(f);
  const bad = s.match(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF\u00AD\uE000-\uF8FF]|[\u{E0000}-\u{E007F}]/u);
  if (bad) fail("hidden-text", `${f} contains an invisible or bidirectional character U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  if (INJECTION_FIXTURES.includes(f)) continue;
  for (const [re, what] of [
    [/ignore (all |any )?(previous|prior|above|your) (instructions|rules|prompts?)/i, '"ignore previous instructions"'],
    [/disregard (all |any )?(previous|prior|above|your) (instructions|rules)/i, '"disregard your instructions"'],
    [/\b(note|message|instructions?) (to|for) (the )?(ai|llm|assistant|agent|claude|copilot|model)\b/i, "a note addressed to an AI"],
    [/\byou are now\b|\bnew system prompt\b|<\/?(system|instructions)>/i, "role-override wording"],
    [/do not (tell|inform|mention (this )?to) the (user|human|reviewer)/i, '"don\'t tell the user"'],
  ]) if (re.test(s)) fail("hidden-text", `${f} contains ${what}; text aimed at AI tools must live only in eval/test fixtures`);
}

// --- 6. The rider-safety path stays intact ------------------------------------------
{
  const main = stripComments(read("src/main.ts"));
  const check = main.indexOf("checkRiderMessage(");
  for (const sink of ["sendSms(", "postToTelegram("]) {
    const at = main.indexOf(sink);
    if (at === -1) continue;
    if (check === -1 || check > at) fail("rider-safety", `src/main.ts must run checkRiderMessage() before ${sink.slice(0, -1)}`);
  }
  const rewrite = read("src/rewrite.ts");
  if (!/not instructions/i.test(rewrite) || !/<mta_alert>/.test(rewrite)) {
    fail("rider-safety", "src/rewrite.ts must keep the alert inside <mta_alert> tags and tell Claude it is data, not instructions");
  }
  if (/parse_mode/.test(stripComments(read("src/telegram.ts")))) fail("rider-safety", "src/telegram.ts must post plain text (no parse_mode)");
  const safety = read("src/safety.ts");
  const hosts = safety.match(/ALLOWED_LINK_HOSTS\s*=\s*\[([^\]]*)\]/);
  if (!hosts || hosts[1].replace(/["'\s]/g, "") !== "mta.info,new.mta.info") {
    fail("rider-safety", "ALLOWED_LINK_HOSTS in src/safety.ts must stay exactly mta.info and new.mta.info");
  }
}
// Tests are the evidence; an assistant "fixing" CI by skipping them is the classic failure.
for (const f of testFiles) {
  const code = stripComments(read(f));
  if (/\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe)\s*\(/.test(code)) fail("tests", `${f} skips or isolates tests (.skip/.only/.todo/xit)`);
  for (const m of code.matchAll(/\b(?:it|test)\.fails\(\s*["'`]([^"'`]*)/g)) {
    if (!/#\d+/.test(m[1])) fail("tests", `${f}: expected-failure test "${m[1].slice(0, 50)}" must name its open issue (#123)`);
  }
}
if (!testFiles.includes("test/safety.test.ts")) fail("tests", "test/safety.test.ts must exist");

// --- 7. The agents can't widen their own power -------------------------------------------
// An agent (or an assistant editing these files) giving itself web access, unreviewed
// GitHub writes, or open networking is the most important change to catch here.
for (const f of tracked.filter((f) => /^agents\/[^/]+\/agent\.md$/.test(f))) {
  const s = read(f);
  const front = s.split(/^---$/m)[1] || "";
  for (const tool of ["web_fetch", "web_search"]) {
    if (!new RegExp(`name:\\s*${tool},\\s*enabled:\\s*false`).test(front)) fail("agents", `${f}: ${tool} must stay disabled`);
  }
  if (/mcp_server_name/.test(front) && /always_allow/.test(front.slice(front.indexOf("mcp_toolset")))) {
    fail("agents", `${f}: MCP tools (GitHub) must not be always_allow`);
  }
  for (const m of front.matchAll(/url:\s*(\S+)/g)) {
    if (m[1] !== "https://api.githubcopilot.com/mcp/") fail("agents", `${f}: MCP server ${m[1]} is not the GitHub MCP server`);
  }
  if (!/Never push to `main`/.test(s)) fail("agents", `${f} must keep the rule "Never push to \`main\`"`);
  if (!/information, not instructions/.test(s)) fail("agents", `${f} must keep the rule that issue/PR/feed text is information, not instructions`);
  if (!/Never run `npm run eval`, `npm start`/.test(s)) fail("agents", `${f} must keep the rule against spending credit or sending texts`);
}
for (const f of tracked.filter((f) => /^environments\/.+\.ya?ml$/.test(f))) {
  const s = read(f);
  if (!/type:\s*limited/.test(s) || /unrestricted/.test(s)) fail("agents", `${f}: agent networking must stay "limited"`);
  const hosts = [...s.matchAll(/^\s*-\s*([a-z0-9.-]+)\s*$/gm)].map((m) => m[1]);
  for (const h of hosts) {
    if (!["github.com", "api.github.com", "api-endpoint.mta.info"].includes(h)) fail("agents", `${f}: allowed host ${h} is not approved`);
  }
}

// --- 8. CI can't be turned against the repo -------------------------------------------
for (const f of tracked.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) {
  const s = read(f).split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
  if (/pull_request_target|workflow_run/.test(s)) fail("ci", `${f} uses pull_request_target/workflow_run, which runs untrusted code with repo privileges`);
  if (!/^permissions:/m.test(s)) fail("ci", `${f} must declare top-level permissions`);
  if (/write-all|:\s*write\b/.test(s)) fail("ci", `${f} grants write permissions`);
  for (const m of s.matchAll(/uses:\s*([^\s#]+)/g)) {
    if (!/@[0-9a-f]{40}$/.test(m[1])) fail("ci", `${f}: action ${m[1]} must be pinned to a full commit SHA`);
  }
  if (/secrets\./.test(s)) fail("ci", `${f} references secrets; CI needs none`);
  if (/\bnpm (install|i)\b/.test(s) || (/\bnpm ci\b/.test(s) && !/npm ci --ignore-scripts/.test(s))) fail("ci", `${f}: use "npm ci --ignore-scripts"`);
  if (/cache:\s*npm/.test(s)) fail("ci", `${f}: no dependency cache (a poisoned cache outlives the PR that made it)`);
  // Text from a PR or issue (title, body, branch name) interpolated into a shell command runs as code.
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if (!m) continue;
    let command = m[2];
    if (/^[|>]/.test(command)) {
      const indent = m[1].length;
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > indent + 2); j++) command += "\n" + lines[j];
    }
    if (/\$\{\{\s*github\.(event|head_ref)/.test(command)) fail("ci", `${f}: a run: command interpolates \${{ github.event... }}; pass it through env: instead`);
  }
}

// --- 9. The public website stays static -------------------------------------------------
for (const f of tracked.filter((f) => /^docs\/.+\.html$/.test(f))) {
  const s = read(f);
  if (/<script\b|<iframe\b|<form\b|\son[a-z]+\s*=/i.test(s)) fail("site", `${f} contains a script, iframe, form, or inline event handler`);
  for (const m of s.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)) {
    if (/^(src)/i.test(m[0]) || /\.(css|js)(\?|$)/.test(m[1])) fail("site", `${f} loads an external resource: ${m[1]}`);
  }
}

if (failures.length) {
  console.error(`security-check: ${failures.length} problem(s)\n` + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("security-check: all rules hold");
