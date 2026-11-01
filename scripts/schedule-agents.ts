/**
 * Creates (or updates) the scheduled deployments that run the maintenance agents.
 * Run after `ant apply` has created the agents, environment, and vault (see docs/agents.md).
 *
 *   CMA_GITHUB_REPO_TOKEN=... npm run schedule-agents            # create/update, left PAUSED
 *   npm run schedule-agents -- --run maintainer                    # one manual test run now
 *   npm run schedule-agents -- --unpause                           # start the schedules
 *
 * Deployments live here instead of in an ant-apply file because each one carries the
 * GitHub token used to clone the repo, and secrets never go in files.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";

const REPO_URL = "https://github.com/MollinBrett/bronx-line-watch";
const TIMEZONE = "America/New_York";

const SCHEDULES = {
  maintainer: {
    agentFile: "./agents/maintainer/agent.md",
    cron: "15 4 * * *", // 4:15 AM daily - outside the 1-3 AM daylight-saving window
    budgetCents: "500", // hard cap per run: $5.00
    kickoff: "Run your nightly maintenance pass.",
  },
  "security-guard": {
    agentFile: "./agents/security-guard/agent.md",
    cron: "45 5 * * *",
    budgetCents: "300",
    kickoff: "Run your daily security review.",
  },
} as const;
type Name = keyof typeof SCHEDULES;

const client = new Anthropic();
const lock = JSON.parse(await readFile("claude-lock.json", "utf8")) as {
  resources: Record<string, { id: string }>;
};
function idFor(path: string): string {
  const id = lock.resources[path]?.id;
  if (!id) throw new Error(`${path} is not in claude-lock.json - run ant apply first (docs/agents.md)`);
  return id;
}
const deploymentName = (name: Name) => `bronx-line-watch-${name}`;

async function existing(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for await (const d of client.beta.deployments.list()) byName.set(d.name, d.id);
  return byName;
}

const args = process.argv.slice(2);
const current = await existing();

if (args[0] === "--run") {
  const name = args[1] as Name;
  const id = current.get(deploymentName(name));
  if (!id) throw new Error(`No deployment for "${args[1]}". Names: ${Object.keys(SCHEDULES).join(", ")}`);
  const run = await client.beta.deployments.run(id);
  console.log(`Started ${name}: https://platform.claude.com/workspaces/default/sessions/${run.session_id}`);
} else if (args[0] === "--unpause") {
  for (const name of Object.keys(SCHEDULES) as Name[]) {
    const id = current.get(deploymentName(name));
    if (id) console.log(`${name}: ${(await client.beta.deployments.unpause(id)).status}`);
  }
} else {
  const token = process.env.CMA_GITHUB_REPO_TOKEN;
  if (!token) throw new Error("Set CMA_GITHUB_REPO_TOKEN (fine-grained token for this repo only - see docs/agents.md)");
  const environment_id = idFor("./environments/agent-sandbox.yaml");
  const vault_id = idFor("./vaults/github.yaml");

  for (const [name, s] of Object.entries(SCHEDULES) as [Name, (typeof SCHEDULES)[Name]][]) {
    const body = {
      agent: idFor(s.agentFile),
      environment_id,
      vault_ids: [vault_id],
      resources: [
        {
          type: "github_repository" as const,
          url: REPO_URL,
          authorization_token: token,
          checkout: { type: "branch" as const, name: "main" },
        },
      ],
      schedule: { type: "cron" as const, expression: s.cron, timezone: TIMEZONE },
      budget: { type: "limit" as const, max_list_cost: { amount: s.budgetCents, currency: "USD" as const } },
      initial_events: [
        { type: "user.message" as const, content: [{ type: "text" as const, text: s.kickoff }] },
      ],
    };
    const id = current.get(deploymentName(name));
    if (id) {
      await client.beta.deployments.update(id, body);
      console.log(`${name}: updated ${id}`);
    } else {
      const d = await client.beta.deployments.create({ name: deploymentName(name), ...body });
      await client.beta.deployments.pause(d.id);
      console.log(`${name}: created ${d.id} (paused). Next: npm run schedule-agents -- --run ${name}`);
    }
  }
}
