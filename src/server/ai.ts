import { z } from "zod";
import { decimalToMinor } from "#/lib/money";
import {
  recordAiUsage,
  type AiUsageKind,
} from "#/server/ai-usage.server";
import { env } from "#/server/env";
import { getLogger } from "#/server/logger";

const CategorizeResponseSchema = z.object({
  category_name: z.string(),
  pattern: z.string().optional(),
});

// The model returns decimal prices; they are converted to integer minor units
// at this boundary (see toMinorUnits) and never used as floats elsewhere.
const RawReceiptItemSchema = z.object({
  name: z.string(),
  quantity: z.number().nonnegative().default(1),
  unit_price: z.number().nonnegative(),
  total_price: z.number().nonnegative(),
  suggested_category: z.string(),
});

const RawReceiptExtractionSchema = z.object({
  store_name: z.string(),
  date: z.string(),
  items: z.array(RawReceiptItemSchema),
  total: z.number(),
  suggested_parent_category: z.string(),
});

export type AISuggestion = z.infer<typeof CategorizeResponseSchema>;

/** Receipt item with prices in integer minor units (grosze/cents). */
export interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price_minor: number;
  total_price_minor: number;
  suggested_category: string;
}

/** Receipt extraction result with all money in integer minor units. */
export interface ReceiptExtraction {
  store_name: string;
  date: string;
  items: ReceiptItem[];
  total_minor: number;
  suggested_parent_category: string;
}

// Converts the model's decimal prices to integer minor units with explicit
// rounding — the single float→minor crossing for receipt scanning.
function toMinorUnits(
  raw: z.infer<typeof RawReceiptExtractionSchema>,
): ReceiptExtraction {
  return {
    store_name: raw.store_name,
    date: raw.date,
    total_minor: decimalToMinor(raw.total),
    suggested_parent_category: raw.suggested_parent_category,
    items: raw.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit_price_minor: decimalToMinor(item.unit_price),
      total_price_minor: decimalToMinor(item.total_price),
      suggested_category: item.suggested_category,
    })),
  };
}

const GEMINI_THINKING_HEADROOM_TOKENS = 1024;

export interface AIConfig {
  provider: "openrouter" | "llamacpp" | "gemini";
  baseURL: string;
  /** Absent for the self-hosted llama.cpp backend — llama-server runs
   * keyless behind a private tunnel, never on a public port. */
  apiKey: string | undefined;
  model: string;
}

/** Caller identity + call kind, threaded into every AI call for metering. */
export interface AICallMeta {
  userId: string;
  kind: AiUsageKind;
}

function getAIConfig(): AIConfig | null {
  // Env is loaded and validated once at startup in src/server/env.ts
  const provider = env.ai.provider;
  const apiKey = env.ai.apiKey;
  const baseURL = env.ai.baseURL || "https://openrouter.ai/api/v1";
  const model =
    env.ai.model || (provider === "llamacpp" ? "local" : "openai/gpt-5-mini");

  // Hosted backends are unusable without a key; llama.cpp needs none.
  if ((provider === "openrouter" || provider === "gemini") && !apiKey) {
    return null;
  }

  return {
    provider,
    // Gemini's OpenAI-compatible path ends in /openai, not /v1.
    baseURL:
      provider === "gemini" || baseURL.endsWith("/v1") ? baseURL : `${baseURL}/v1`,
    apiKey,
    model,
  };
}

/**
 * Pings the configured AI backend (`GET /v1/models`, short timeout). Used by
 * the readiness endpoint as a non-gating check — an unreachable backend
 * degrades receipt scanning, it must not take the instance out of rotation.
 */
export async function checkAIBackendHealth(): Promise<
  "ok" | "error" | "unconfigured"
> {
  if (env.ai.fake) return "ok";
  const config = getAIConfig();
  if (!config) return "unconfigured";
  try {
    const response = await fetch(`${config.baseURL}/models`, {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

function getFakeSuggestion(description: string): {
  category: string;
  pattern: string;
} {
  const fakeMap: Record<string, { category: string; pattern: string }> = {
    "Costa Coffee": { category: "Cafe", pattern: "Costa" },
    "NETFLIX.COM": { category: "Entertainment", pattern: "NETFLIX" },
    SPOTIFY: { category: "Entertainment", pattern: "SPOTIFY" },
    AMAZON: { category: "Shopping", pattern: "AMAZON" },
    UBER: { category: "Transport", pattern: "UBER" },
    NETFLIX: { category: "Entertainment", pattern: "NETFLIX" },
  };

  for (const [key, value] of Object.entries(fakeMap)) {
    if (description.toUpperCase().includes(key.toUpperCase())) {
      return value;
    }
  }

  return { category: "Entertainment", pattern: "test" };
}

//
// One ai_usage row is written per callAI invocation (tokens and cost summed
// across the malformed-JSON retry), attributed to the calling user. A
// response that is not valid JSON for the schema gets exactly one corrective
// retry — llama.cpp grammar constraints usually prevent this, but smaller
// local models occasionally emit truncated JSON.
async function callAI<T extends z.ZodType>(
  config: AIConfig,
  messages: Array<{ role: string; content: unknown }>,
  zodSchema: T,
  meta: AICallMeta,
  overrides: {
    max_tokens?: number;
  } = {},
): Promise<
  { success: true; data: z.infer<T> } | { success: false; error: Error }
> {
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicrousd = 0;

  // Metering must never turn a successful extraction into a failure.
  const record = async () => {
    try {
      await recordAiUsage({
        userId: meta.userId,
        kind: meta.kind,
        provider: config.provider,
        model: config.model,
        inputTokens,
        outputTokens,
        costEstimateMicrousd: costMicrousd,
      });
    } catch (err) {
      getLogger().warn(
        { err: err instanceof Error ? err.message : String(err) },
        "failed to record ai usage",
      );
    }
  };

  const finish = async <R>(result: R): Promise<R> => {
    await record();
    return result;
  };

  const convo = [...messages];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = performance.now();
      const body: Record<string, unknown> = {
        model: config.model,
        messages: convo,
        temperature: 0.1,
        max_tokens: overrides.max_tokens ?? 100,
      };

      if (config.provider === "gemini") {
        // Gemini 3 models cannot switch thinking off; "minimal" keeps it
        // from eating the output budget. Thinking tokens count against
        // max_tokens, so leave headroom on top of the caller's budget.
        body.reasoning_effort = "minimal";
        body.max_tokens = (overrides.max_tokens ?? 100) + GEMINI_THINKING_HEADROOM_TOKENS;
      } else {
        // llama.cpp-specific; strict OpenAI-compatible APIs may reject it.
        body.chat_template_kwargs = { enable_thinking: false };
      }

      // OpenRouter reports the actual charge (in USD) when asked — the
      // source for cost_estimate_microusd. llama.cpp calls cost nothing.
      // Gemini reports tokens only, so its cost is not metered here.
      if (config.provider === "openrouter") {
        body.usage = { include: true };
      }

      const jsonSchema: Record<string, unknown> = {
        ...z.toJSONSchema(zodSchema, { target: "draft-04" }),
      };
      // Gemini's schema subset does not accept the "$schema" draft marker.
      if (config.provider === "gemini") delete jsonSchema.$schema;
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "json_schema",
          strict: true,
          schema: jsonSchema,
        },
      };

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        getLogger().warn(
          {
            provider: config.provider,
            model: config.model,
            status: response.status,
            latencyMs: Math.round(performance.now() - startedAt),
          },
          "ai call failed",
        );
        return finish({
          success: false,
          error: new Error(`AI API error: ${response.status} - ${errorText}`),
        });
      }

      const data = await response.json();

      inputTokens += data.usage?.prompt_tokens ?? 0;
      outputTokens += data.usage?.completion_tokens ?? 0;
      if (config.provider === "openrouter" && data.usage?.cost) {
        costMicrousd += Math.round(data.usage.cost * 1_000_000);
      }

      // Every real AI call is metered: model, latency, and token usage, with
      // the user id attached via the request context. Prompt and response
      // contents are never logged — they contain financial data. Durable
      // metering goes to the ai_usage table via recordAiUsage.
      getLogger().info(
        {
          provider: config.provider,
          model: config.model,
          latencyMs: Math.round(performance.now() - startedAt),
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          retry: attempt > 0,
        },
        "ai call",
      );

      if (data.error) {
        return finish({
          success: false,
          error: new Error(`AI API error: ${data.error.message}`),
        });
      }

      const content = (data.choices?.[0]?.message?.content ?? "").trim();
      let parseError: string;
      try {
        const parsed = zodSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          return finish(parsed);
        }
        parseError = parsed.error.message;
      } catch (err) {
        parseError = err instanceof Error ? err.message : "invalid JSON";
      }

      if (attempt === 1) {
        return finish({
          success: false,
          error: new Error(`AI returned invalid JSON: ${parseError}`),
        });
      }

      getLogger().warn(
        { provider: config.provider, model: config.model },
        "ai response failed json validation, retrying once",
      );
      convo.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `Your previous response was not valid JSON for the required schema (${parseError}). Respond again with ONLY a valid JSON object matching the schema.`,
        },
      );
    }
    // Unreachable — the loop always returns on attempt 1.
    return { success: false, error: new Error("AI request failed") };
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Unknown error");
    return finish({
      success: false,
      error: new Error(`AI request failed: ${error.message}`),
    });
  }
}

// Fake-mode calls are metered like real ones (provider "fake", zero tokens
// and cost) so quota accounting behaves identically in tests and demos.
async function recordFakeUsage(meta: AICallMeta): Promise<void> {
  await recordAiUsage({
    userId: meta.userId,
    kind: meta.kind,
    provider: "fake",
    model: "fake",
    inputTokens: 0,
    outputTokens: 0,
    costEstimateMicrousd: 0,
  });
}

export async function categorizeDescription(
  description: string,
  categories: Array<{ id: string; name: string }>,
  meta: AICallMeta,
): Promise<
  | { success: true; category_name: string; pattern?: string }
  | { success: false; error: Error }
> {
  if (env.ai.fake) {
    await recordFakeUsage(meta);
    const suggested = getFakeSuggestion(description);
    const match = categories.find(
      (c) => c.name.toLowerCase() === suggested.category.toLowerCase(),
    );
    if (match) {
      return {
        success: true,
        category_name: match.name,
        pattern: suggested.pattern,
      };
    }
    return {
      success: true,
      category_name: categories[0]?.name || "Uncategorized",
      pattern: suggested.pattern,
    };
  }

  const config = getAIConfig();
  if (!config) {
    return { success: false, error: new Error("AI not configured") };
  }

  const categoryList = categories.map((c) => c.name).join(", ");

  const systemPrompt = `You are a financial categorization assistant. Given a transaction description and a list of available categories, choose the most appropriate category.

Additionally, extract a substring pattern (a distinctive keyword or phrase from the description) that could match similar transactions in the future.
Only output JSON.`;

  const userPrompt = `Transaction description: "${description}"

Available categories: ${categoryList}

Choose the best category and extract a matching pattern.`;

  const result = await callAI(
    config,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    CategorizeResponseSchema,
    meta,
  );

  if (!result.success) {
    return result;
  }

  // Normalize category name to an exact match from the list
  const match = categories.find(
    (c) => c.name.toLowerCase() === result.data.category_name.toLowerCase(),
  );

  if (!match) {
    // Try partial match as fallback
    const partial = categories.find(
      (c) =>
        c.name
          .toLowerCase()
          .includes(result.data.category_name.toLowerCase()) ||
        result.data.category_name.toLowerCase().includes(c.name.toLowerCase()),
    );

    if (!partial) {
      return {
        success: false,
        error: new Error(
          `AI suggested unknown category: "${result.data.category_name}"`,
        ),
      };
    }

    return {
      success: true,
      category_name: partial.name,
      pattern: result.data.pattern,
    };
  }

  return {
    success: true,
    category_name: match.name,
    pattern: result.data.pattern,
  };
}

// ── extractReceiptItems ──────────────────────────────────────────────────────

export async function extractReceiptItems(
  imageB64: string,
  categories: Array<{ id: string; name: string; parent_id: string | null }>,
  meta: AICallMeta,
  imageExt: string = "png",
): Promise<
  { success: true; data: ReceiptExtraction } | { success: false; error: Error }
> {
  // Build category hierarchy for the prompt
  const topCategories = categories.filter((c) => c.parent_id === null);
  const subCategories = categories.filter((c) => c.parent_id !== null);

  const categoryStructure = topCategories.map((top) => {
    const children = subCategories.filter((c) => c.parent_id === top.id);
    const childNames = children.map((c) => c.name);
    return { name: top.name, children: childNames };
  });

  if (env.ai.fake) {
    await recordFakeUsage(meta);
    const fakeStore = "FAKE_STORE";
    const fakeItems: ReceiptItem[] = [
      {
        name: "Product A",
        quantity: 2,
        unit_price_minor: 1050,
        total_price_minor: 2100,
        suggested_category: "Alcohol",
      },
      {
        name: "Product B",
        quantity: 1,
        unit_price_minor: 1599,
        total_price_minor: 1599,
        suggested_category: "Vegetables",
      },
    ];
    return {
      success: true,
      data: {
        store_name: fakeStore,
        date: new Date().toISOString().split("T")[0],
        items: fakeItems,
        total_minor: 3699,
        suggested_parent_category:
          categoryStructure[0]?.name || "Uncategorized",
      },
    };
  }

  const config = getAIConfig();
  if (!config) {
    return { success: false, error: new Error("AI not configured") };
  }

  const categoryStructureJson = JSON.stringify(categoryStructure, null, 2);

  const systemPrompt = `You are a receipt analysis assistant. Given a receipt image, extract all items and metadata into structured JSON.

Available categories and their sub-categories:
${categoryStructureJson}

Rules:
- Extract ALL items visible on the receipt
- Each item must have: name, quantity (default 1), unit_price, total_price
- For each item, suggest a category from the sub-categories list above
- For the overall receipt, suggest a parent category from the top-level categories
- The date should be in YYYY-MM-DD format
- The total should match the receipt total
- If a sub-category doesn't exist for an item, use the most appropriate parent category
- If an item has a discount, record the final discounted price in total_price

Only output JSON.`;

  const userPrompt = "Extract all receipt data from this image.";

  const result = await callAI(
    config,
    [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/${imageExt};base64,${imageB64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    RawReceiptExtractionSchema,
    meta,
    { max_tokens: 5000 },
  );

  if (!result.success) {
    return result;
  }

  const extracted = toMinorUnits(result.data);

  // Normalize suggested parent category to an exact match from the list
  let finalParent = extracted.suggested_parent_category;
  if (finalParent) {
    const match = categories.find(
      (c) => c.name.toLowerCase() === finalParent.toLowerCase(),
    );
    if (match) {
      finalParent = match.name;
    } else {
      const partial = categories.find(
        (c) =>
          c.name.toLowerCase().includes(finalParent.toLowerCase()) ||
          finalParent.toLowerCase().includes(c.name.toLowerCase()),
      );
      if (partial) {
        finalParent = partial.name;
      } else {
        finalParent = topCategories[0]?.name || "";
      }
    }
  }

  // Normalize item category suggestions
  for (const item of extracted.items) {
    if (item.suggested_category) {
      const itemMatch = categories.find(
        (c) => c.name.toLowerCase() === item.suggested_category.toLowerCase(),
      );
      if (itemMatch) {
        item.suggested_category = itemMatch.name;
      } else {
        const partialMatch = categories.find(
          (c) =>
            c.name
              .toLowerCase()
              .includes(item.suggested_category.toLowerCase()) ||
            item.suggested_category
              .toLowerCase()
              .includes(c.name.toLowerCase()),
        );
        if (partialMatch) {
          item.suggested_category = partialMatch.name;
        }
      }
    }
  }

  return {
    success: true,
    data: {
      store_name: extracted.store_name,
      date: extracted.date,
      items: extracted.items,
      total_minor: extracted.total_minor,
      suggested_parent_category: finalParent,
    },
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export function isAIVisible(): boolean {
  const config = getAIConfig();
  return config !== null;
}
