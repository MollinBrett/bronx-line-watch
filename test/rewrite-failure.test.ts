import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { RiderMessage, rewriteFailureKind } from "../src/rewrite.js";
import { parseBetaMessage } from "@anthropic-ai/sdk/lib/beta-parser";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

describe("rewriteFailureKind (#65)", () => {
  it("treats a failed request as an API failure", () => {
    expect(rewriteFailureKind(new Anthropic.APIConnectionError({ message: "socket hang up" }))).toBe("api");
    expect(rewriteFailureKind(Anthropic.APIError.generate(529, undefined, "overloaded", new Headers()))).toBe("api");
    expect(rewriteFailureKind(Anthropic.APIError.generate(429, undefined, "rate limited", new Headers()))).toBe("api");
  });

  it("treats the SDK's error for JSON cut off by max_tokens as unusable output", () => {
    const params = { output_config: { format: betaZodOutputFormat(RiderMessage) } };
    const cutOff = { content: [{ type: "text", text: '{"en": "[4] trains are' }], stop_reason: "max_tokens" };
    let thrown: unknown;
    try {
      parseBetaMessage(cutOff as never, params as never, { logger: console } as never);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Anthropic.AnthropicError);
    expect(rewriteFailureKind(thrown)).toBe("output");
  });

  it("treats anything unexpected as unusable output, so it cannot be retried forever", () => {
    expect(rewriteFailureKind(new TypeError("boom"))).toBe("output");
  });
});
