import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { alertPrompt, rewriteAlert, rewriteOptionsFromEnv } from "../src/rewrite.js";
import { makeAlert } from "./helpers.js";

function fakeClient(response: object) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("rewriteAlert", () => {
  it("wraps the alert in tags so Claude treats it as data", () => {
    expect(alertPrompt(makeAlert())).toMatch(/^<mta_alert>[\s\S]*<\/mta_alert>$/);
  });

  it("returns the parsed message", async () => {
    const msg = { en: "[4] delayed.", es: "[4] con retrasos." };
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: msg });
    expect(await rewriteAlert(client, makeAlert())).toEqual(msg);
    const params = parse.mock.calls[0]![0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
  });

  it("returns null when Claude declines", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", parsed_output: null });
    expect(await rewriteAlert(client, makeAlert())).toBeNull();
  });
});

describe("rewriteOptionsFromEnv", () => {
  it("defaults to Opus at low effort", () => {
    expect(rewriteOptionsFromEnv({})).toEqual({ model: "claude-opus-5-5", effort: "low" });
  });

  it("reads CLAUDE_MODEL and CLAUDE_EFFORT", () => {
    expect(rewriteOptionsFromEnv({ CLAUDE_MODEL: "claude-sonnet-5-5", CLAUDE_EFFORT: "medium" })).toEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
  });

  it("rejects an unknown effort instead of silently using it", () => {
    expect(() => rewriteOptionsFromEnv({ CLAUDE_EFFORT: "turbo" })).toThrow(/CLAUDE_EFFORT/);
  });
});
