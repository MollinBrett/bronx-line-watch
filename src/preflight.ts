import Anthropic from "@anthropic-ai/sdk";

export type PreflightResult =
  | { ok: true; message: string }
  | { ok: false; fatal: boolean; message: string };

/**
 * Check the API key and model at startup with a free call (model lookup, no tokens used),
 * so a bad key shows up seconds after a deploy instead of at the next subway alert.
 */
export async function checkClaude(client: Anthropic, model: string): Promise<PreflightResult> {
  try {
    const info = await client.models.retrieve(model);
    return { ok: true, message: `Claude API key OK (model ${info.id})` };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401) {
        return { ok: false, fatal: true, message: "ANTHROPIC_API_KEY is missing or invalid - update it in your host's environment settings" };
      }
      if (err.status === 403) {
        return { ok: false, fatal: true, message: "ANTHROPIC_API_KEY doesn't have permission - check the key's workspace in the Claude Console" };
      }
      if (err.status === 404) {
        return { ok: false, fatal: true, message: `Model "${model}" isn't available to this key - check CLAUDE_MODEL` };
      }
    }
    // Network blips or API hiccups: worth a warning, not worth refusing to start.
    return { ok: false, fatal: false, message: `Couldn't verify the Claude API key yet: ${String(err)}` };
  }
}
