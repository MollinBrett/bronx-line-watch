#!/usr/bin/env node
// Fails if any package in package-lock.json was published less than
// MIN_AGE_DAYS ago. Most malicious npm releases (hijacked maintainer accounts,
// typosquats) are found and pulled within days; waiting a week lets that
// happen before the code reaches this repo. SECURITY.md 3.2.
//
//   node scripts/freshness-check.mjs            default 7 days
//   MIN_AGE_DAYS=3 node scripts/freshness-check.mjs

import { readFileSync } from "node:fs";

const MIN_AGE_DAYS = Number(process.env.MIN_AGE_DAYS || 7);
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const wanted = new Map();
for (const [key, p] of Object.entries(lock.packages || {})) {
  if (!key || p.link || !p.version) continue;
  wanted.set(`${key.replace(/^.*node_modules\//, "")}@${p.version}`, { name: key.replace(/^.*node_modules\//, ""), version: p.version });
}

// The registry occasionally drops a connection; retry a few times before
// failing the gate, so a network blip is not mistaken for a supply-chain problem.
async function getWithRetry(name, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`${name}: registry ${r.status}`);
      if (i >= tries) throw new Error(`${name}: registry ${r.status} after ${tries} tries`);
    } catch (e) {
      if (i >= tries || /registry 4\d\d/.test(String(e.message))) throw e;
    }
    await new Promise((res) => setTimeout(res, 500 * 2 ** i));
  }
}

const cutoff = Date.now() - MIN_AGE_DAYS * 86_400_000;
const names = [...new Set([...wanted.values()].map((w) => w.name))];
const times = new Map();
const queue = [...names];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const n = queue.shift();
    times.set(n, (await getWithRetry(n)).time || {});
  }
}));

const fresh = [];
for (const { name, version } of wanted.values()) {
  const t = times.get(name)?.[version];
  if (!t) { fresh.push(`${name}@${version}: no publish time in registry`); continue; }
  if (Date.parse(t) > cutoff) fresh.push(`${name}@${version}: published ${t}`);
}
if (fresh.length) {
  console.error(`freshness-check: ${fresh.length} package(s) newer than ${MIN_AGE_DAYS} days\n  - ${fresh.join("\n  - ")}\nWait, or pin an older version. See SECURITY.md 3.2.`);
  process.exit(1);
}
console.log(`freshness-check: all ${wanted.size} locked packages are older than ${MIN_AGE_DAYS} days`);
