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

  it("asks Claude for exactly the two-field en/es schema", async () => {
    // The SDK turns our zod schema into the JSON schema Claude must follow. Pin it, so an SDK
    // upgrade that changes what Claude is asked for shows up here instead of only in production.
    // (@anthropic-ai/sdk before 1.9.0 also sent a junk description: '{$schema: "https://..."}'.)
    const { client, parse } = fakeClient({ stop_reason: "end_turn", parsed_output: { en: "x", es: "x" } });
    await rewriteAlert(client, makeAlert());
    const format = parse.mock.calls[0]![0].output_config.format;
    expect(format.type).toBe("json_schema");
    expect(format.schema).toEqual({
      type: "object",
      properties: {
        en: { type: "string", description: "Plain-English text message for riders" },
        es: { type: "string", description: "The same message in natural New York Spanish" },
      },
      additionalProperties: false,
      required: ["en", "es"],
    });
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
