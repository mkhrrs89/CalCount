// Cloudflare Pages Function: POST /api/estimate
// Receives { imageDataUrl?, mealLabel?, note?, candidates?[] } and returns structured JSON.

function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "";
  const allowOrigin = allowed ? (origin === allowed ? origin : "") : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function extractOutputText(respJson) {
  // Responses API: resp.output[] items; message content[] with type output_text
  const out = respJson?.output || [];
  let text = "";
  for (const item of out) {
    if (item?.type !== "message") continue;
    const content = item?.content || [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
    }
  }
  return text.trim();
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env);
  if (env.ALLOWED_ORIGIN) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "Origin not allowed." }, { status: 403, headers: cors });
    }
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(
      { error: "Missing OPENAI_API_KEY. Set it in Cloudflare Pages → Settings → Environment variables." },
      { status: 500, headers: cors }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400, headers: cors });
  }

  const imageDataUrl = body?.imageDataUrl || null;
  const note = (body?.note || "").toString();
  const mealLabel = (body?.mealLabel || "").toString();
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];

  if (!imageDataUrl && !note && !mealLabel) {
    return json({ error: "Provide at least an image or text note/label." }, { status: 400, headers: cors });
  }

  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  // Structured output schema (Responses API: text.format json_schema)
  const schema = {
    name: "calorie_estimate",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        estimated_calories: { type: "integer", minimum: 0 },
        range_low: { type: "integer", minimum: 0 },
        range_high: { type: "integer", minimum: 0 },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        matched_candidate_index: { type: "integer", minimum: -1 },
        matched_candidate_reason: { type: "string" },
        breakdown: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              item: { type: "string" },
              calories: { type: "integer", minimum: 0 }
            },
            required: ["item", "calories"]
          }
        },
        questions: { type: "array", items: { type: "string" }, maxItems: 2 },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
      required: [
        "label",
        "estimated_calories",
        "range_low",
        "range_high",
        "confidence",
        "matched_candidate_index",
        "matched_candidate_reason",
        "breakdown",
        "questions",
        "assumptions"
      ],
    },
    strict: true,
  };

  // Build user message: include local candidates so the model can anchor to "your usual"
  const candidatesText = candidates.length
    ? `Your local food library candidates (choose the best match if relevant; otherwise ignore):\n` +
      candidates.map((c, i) => {
        const tags = Array.isArray(c.tags) ? c.tags.join(", ") : "";
        return `#${i + 1}: ${c.name} — ${c.calories} cal${c.portion ? ` (${c.portion})` : ""}${tags ? ` [${tags}]` : ""}${c.notes ? ` | notes: ${c.notes}` : ""}`;
      }).join("\n")
    : "No local food library candidates provided.";

  const userText =
    `Estimate calories for the user's meal.\n` +
    `Meal label (optional): ${mealLabel || "—"}\n` +
    `User note (optional): ${note || "—"}\n\n` +
    `${candidatesText}\n\n` +
    `Rules:\n` +
    `- Use the photo if provided. If not, infer from text.\n` +
    `- If a candidate clearly matches the meal, base your estimate on that and set matched_candidate_index (0-based). Otherwise set -1.\n` +
    `- Provide an estimated_calories (single best guess) and a realistic range_low/range_high.\n` +
    `- Keep questions to max 2, only if they materially change calories.\n` +
    `- Don't be overconfident: use confidence low/medium/high.\n` +
    `- Breakdown items should roughly add up to estimated_calories.\n`;

  const input = [
    {
      role: "system",
      content:
        "You are a careful calorie estimation assistant. Be realistic about uncertainty (oils, sauces, portion sizes). " +
        "Prefer the user's local food candidates when they match. Output must follow the provided JSON schema exactly."
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl, detail: "low" }] : [])
      ]
    }
  ];

  const payload = {
    model,
    store: false,
    temperature: 0.2,
    max_output_tokens: 650,
    input,
    text: {
      format: { type: "json_schema", strict: true, schema: schema.schema, name: schema.name }
    }
  };

  let resp;
  try {
    resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ error: "Failed to reach OpenAI API.", detail: String(e) }, { status: 502, headers: cors });
  }

  if (!resp.ok) {
    const t = await resp.text();
    return json(
      { error: "OpenAI API error.", status: resp.status, detail: t.slice(0, 1200) },
      { status: 502, headers: cors }
    );
  }

  const data = await resp.json();
  const textOut = extractOutputText(data);

  try {
    const parsed = JSON.parse(textOut);
    return json(parsed, { status: 200, headers: cors });
  } catch {
    // Should be rare with json_schema, but just in case
    return json({ error: "Failed to parse model JSON.", raw: textOut.slice(0, 4000) }, { status: 500, headers: cors });
  }
}
