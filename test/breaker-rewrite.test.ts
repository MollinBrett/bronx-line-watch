import type Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vitest";
import { rewriteAlert } from "../src/rewrite.js";
import { makeAlert } from "./helpers.js";

// The circuit breaker counts one Claude request per call (#56). If the SDK retried on its own,
// one counted call could be three requests.
it("asks the SDK not to retry on its own", async () => {
  const parse = vi.fn().mockResolvedValue({ stop_reason: "end_turn", parsed_output: { en: "[4] delays.", es: "[4] retrasos." } });
  const client = { beta: { messages: { parse } } } as unknown as Anthropic;
  await rewriteAlert(client, makeAlert());
  expect(parse.mock.calls[0]![1]).toEqual({ maxRetries: 0 });
});
