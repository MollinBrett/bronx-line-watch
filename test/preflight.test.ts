import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { checkClaude } from "../src/preflight.js";

function clientThat(retrieve: () => Promise<unknown>) {
  return { models: { retrieve: vi.fn(retrieve) } } as unknown as Anthropic;
}
const apiError = (status: number) => new Anthropic.APIError(status, {}, "error", new Headers());

describe("checkClaude", () => {
  it("reports OK when the model lookup works", async () => {
    const r = await checkClaude(clientThat(async () => ({ id: "claude-opus-5-5" })), "claude-opus-5-5");
    expect(r).toEqual({ ok: true, message: "Claude API key OK (model claude-opus-5-5)" });
  });

  it.each([401, 403, 404])("treats HTTP %i as fatal", async (status) => {
    const r = await checkClaude(clientThat(async () => { throw apiError(status); }), "claude-opus-5-5");
    expect(r).toMatchObject({ ok: false, fatal: true });
  });

  it("only warns on network or server trouble", async () => {
    const r = await checkClaude(clientThat(async () => { throw apiError(503); }), "claude-opus-5-5");
    expect(r).toMatchObject({ ok: false, fatal: false });
    const r2 = await checkClaude(clientThat(async () => { throw new Error("ECONNRESET"); }), "claude-opus-5-5");
    expect(r2).toMatchObject({ ok: false, fatal: false });
  });
});
