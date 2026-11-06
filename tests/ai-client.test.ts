// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { categorizeDescription } from "../src/server/ai.ts";
import { env } from "../src/server/env.ts";

// Exercises the shared AI client through categorizeDescription with a mocked
// fetch: provider selection (keyless llama.cpp), the malformed-JSON
// corrective retry, and per-call ai_usage metering.

describe("ai client (callAI)", () => {
  const userId = "ai-client-test-user";
  const meta = { userId, kind: "categorize" as const };
  const categories = [{ id: "c1", name: "Cafe" }];

  const originalAi = { ...env.ai };
  const fetchMock = vi.fn();

  const aiResponse = (content: string, tokens = { in: 10, out: 5 }) =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out },
      }),
      { status: 200 },
    );

  beforeEach(async () => {
    Object.assign(env.ai, {
      fake: false,
      provider: "llamacpp",
      apiKey: undefined,
      baseURL: "http://llm.test/v1",
      model: "test-model",
    });
    vi.stubGlobal("fetch", fetchMock);
    await db.insert(schema.users).values({
      id: userId,
      username: userId,
      password_hash: "x",
    });
  });

  afterEach(async () => {
    Object.assign(env.ai, originalAi);
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    await db.delete(schema.ai_usage);
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("parses a valid response and writes one ai_usage row", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse('{"category_name":"Cafe"}'));

    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(true);
    if (result.success) expect(result.category_name).toBe("Cafe");

    // Keyless llama.cpp: no Authorization header is sent.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://llm.test/v1/chat/completions");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();

    const rows = await db.select().from(schema.ai_usage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: userId,
      kind: "categorize",
      provider: "llamacpp",
      model: "test-model",
      input_tokens: 10,
      output_tokens: 5,
      cost_estimate_microusd: 0,
    });
  });

  it("retries once on malformed JSON and sums tokens into a single usage row", async () => {
    fetchMock
      .mockResolvedValueOnce(aiResponse("not json at all"))
      .mockResolvedValueOnce(
        aiResponse('{"category_name":"Cafe"}', { in: 20, out: 8 }),
      );

    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The retry request carries the corrective follow-up message.
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(retryBody.messages.at(-1).role).toBe("user");
    expect(retryBody.messages.at(-1).content).toContain("not valid JSON");

    const rows = await db.select().from(schema.ai_usage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input_tokens: 30, output_tokens: 13 });
  });

  it("fails (and still meters) when the retry is also malformed", async () => {
    fetchMock
      .mockResolvedValueOnce(aiResponse("garbage"))
      .mockResolvedValueOnce(aiResponse("more garbage"));

    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("invalid JSON");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.ai_usage)).toHaveLength(1);
  });

  it("captures OpenRouter cost as micro-USD and requests usage accounting", async () => {
    Object.assign(env.ai, {
      provider: "openrouter",
      apiKey: "test-key",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"category_name":"Cafe"}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 },
        }),
        { status: 200 },
      ),
    );

    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.usage).toEqual({ include: true });

    const rows = await db.select().from(schema.ai_usage);
    expect(rows[0]).toMatchObject({
      provider: "openrouter",
      cost_estimate_microusd: 12_300,
    });
  });

  it("sends Gemini a request its OpenAI-compatible endpoint accepts", async () => {
    Object.assign(env.ai, {
      provider: "gemini",
      apiKey: "gemini-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-test",
    });
    fetchMock.mockResolvedValueOnce(aiResponse('{"category_name":"Cafe"}'));

    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    // no "/v1" appended to Google's /openai path
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(init.headers.Authorization).toBe("Bearer gemini-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gemini-test");
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.usage).toBeUndefined();
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();

    const rows = await db.select().from(schema.ai_usage);
    expect(rows[0]).toMatchObject({ provider: "gemini" });
  });

  it("fake mode records a zero-cost usage row without calling fetch", async () => {
    env.ai.fake = true;
    const result = await categorizeDescription("COSTA", categories, meta);
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const rows = await db.select().from(schema.ai_usage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "fake",
      cost_estimate_microusd: 0,
    });
  });
});
