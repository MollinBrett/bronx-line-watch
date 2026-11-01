/**
 * Quality eval: rewrite each case with the production prompt, then have Claude grade
 * the result against evals/rubric.md. Costs real API credit (~2 calls per case).
 *
 *   npm run eval
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { alertPrompt, rewriteAlert } from "../src/rewrite.js";
import { checkRiderMessage } from "../src/safety.js";
import { smsSegments } from "../src/sms.js";
import { evalCases } from "./cases.js";

const client = new Anthropic();
const model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const rubric = await readFile(new URL("./rubric.md", import.meta.url), "utf8");

const Grade = z.object({
  criteria: z.array(
    z.object({ number: z.number(), language: z.enum(["en", "es"]), pass: z.boolean(), reason: z.string() }),
  ),
});

const results: Array<{ id: string; error?: string; criteria?: z.infer<typeof Grade>["criteria"]; [k: string]: unknown }> = [];
for (const alert of evalCases()) {
  const msg = await rewriteAlert(client, alert, { model });
  if (!msg) {
    results.push({ id: alert.id, error: "no message" });
    console.log(`✗ ${alert.id}: no message`);
    continue;
  }
  const grade = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Grade) },
    system: `You grade text messages written for subway riders against a rubric. Be strict: when in doubt, fail the criterion and say why.\n\n${rubric}`,
    messages: [
      {
        role: "user",
        content: `Original alert:\n${alertPrompt(alert)}\n\nEnglish message:\n${msg.en}\n\nSpanish message:\n${msg.es}\n\nGrade criteria 1-5 for both "en" and "es", and criteria 6-8 for "es" only.`,
      },
    ],
  });
  const criteria = grade.parsed_output?.criteria ?? [];
  const failed = criteria.filter((c) => !c.pass);
  const safety = checkRiderMessage(msg, alert);
  results.push({
    id: alert.id,
    message: msg,
    segments: { en: smsSegments(msg.en), es: smsSegments(msg.es) },
    safetyProblems: safety,
    criteria,
  });
  console.log(`${failed.length || safety.length ? "✗" : "✓"} ${alert.id}  (${criteria.length - failed.length}/${criteria.length} criteria)`);
  for (const f of failed) console.log(`    fail #${f.number} ${f.language}: ${f.reason}`);
  for (const p of safety) console.log(`    safety: ${p}`);
}

const all = results.flatMap((r) => r.criteria ?? []);
const passRate = all.length ? all.filter((c) => c.pass).length / all.length : 0;
console.log(`\nOverall: ${(passRate * 100).toFixed(1)}% of criteria passed across ${results.length} cases`);

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
const out = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
await writeFile(out, JSON.stringify({ model, passRate, results }, null, 2));
console.log(`Saved ${out.pathname}`);
