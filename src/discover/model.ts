import { parseModelAction, type ProposedAction } from "./action.ts";

export type ModelControl = {
  role: string;
  name: string;
  inFrame: boolean;
};

export type ModelTurn = {
  goal: string;
  url: string;
  controls: ModelControl[];
  recent: string[];
  checkpointMet: boolean;
  outputName: string;
};

export type ModelClient = {
  nextAction(turn: ModelTurn): Promise<ProposedAction>;
};

const systemPrompt = [
  "You drive a bank servicing screen one action at a time. Reply with one JSON object and no other text.",
  'navigate: {"action":"navigate","path":"/members","reason":"why"}',
  'click: {"action":"click","role":"button","name":"Look up","reason":"why"}',
  'type: {"action":"type","role":"textbox","name":"Member number","text":"the value","reason":"why"}',
  'extract: {"action":"extract","nearbyText":"Savings balance","bind":"the output name","reason":"why"}',
  'done: {"action":"done","reason":"why"}',
  "Use role and name exactly as listed. path is an application path, not a full URL.",
  "To read a value beside a label, extract with nearbyText set to that label.",
  "Never click Confirm, Submit, Transfer, or Delete.",
  "If the page says no member matches, enter the member number from the goal and look up again.",
  "Return done only after the requested value has been extracted.",
].join("\n");

export function renderTurn(turn: ModelTurn): string {
  const controls = turn.controls.slice(0, 40).map((control) => {
    const frame = control.inFrame ? " (frame)" : "";
    return `- ${control.role} "${control.name}"${frame}`;
  });
  const recent = turn.recent.slice(-12);
  return [
    `Goal: ${turn.goal}`,
    `URL: ${turn.url}`,
    `Checkpoint met: ${turn.checkpointMet ? "yes" : "no"}`,
    `Extract bind: ${turn.outputName}`,
    "Recent actions:",
    ...(recent.length > 0 ? recent.map((line, index) => `${index + 1}. ${line}`) : ["(none)"]),
    "Controls:",
    ...(controls.length > 0 ? controls : ["(none)"]),
  ].join("\n");
}

export function createModelClient(env: Record<string, string | undefined> = process.env): ModelClient {
  if (present(env.ANTHROPIC_API_KEY)) {
    return anthropicClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5");
  }
  if (present(env.OPENAI_API_KEY)) {
    return openAIClient({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
      jsonMode: !env.OPENAI_BASE_URL,
    });
  }
  if (present(env.XAI_API_KEY)) {
    return openAIClient({
      apiKey: env.XAI_API_KEY,
      baseUrl: "https://api.x.ai/v1",
      model: env.XAI_MODEL ?? "grok-3",
      jsonMode: false,
    });
  }
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY. The key is read from the environment and is not written to disk.");
}

function anthropicClient(apiKey: string, model: string): ModelClient {
  return {
    async nextAction(turn: ModelTurn): Promise<ProposedAction> {
      const body = await postJson("https://api.anthropic.com/v1/messages", {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model,
        max_tokens: 300,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: "user", content: renderTurn(turn) }],
      });
      const blocks = asBlocks(body.content);
      const text = blocks.map((block) => block.text ?? "").join("\n");
      return parseModelAction(text);
    },
  };
}

function openAIClient(options: { apiKey: string; baseUrl: string; model: string; jsonMode: boolean }): ModelClient {
  return {
    async nextAction(turn: ModelTurn): Promise<ProposedAction> {
      const body = await postJson(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      }, {
        model: options.model,
        temperature: 0,
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: renderTurn(turn) },
        ],
      });
      const content = firstChoiceContent(body);
      return parseModelAction(content);
    },
  };
}

async function postJson(url: string, headers: Record<string, string>, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
  const parsed: unknown = await response.json();
  if (!parsed || typeof parsed !== "object") throw new Error("Model response was empty.");
  return parsed as Record<string, unknown>;
}

function asBlocks(value: unknown): { text?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { text?: string } => Boolean(item) && typeof item === "object");
}

function firstChoiceContent(body: Record<string, unknown>): string {
  const choices = body.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!first || typeof first !== "object") throw new Error("Model returned no action.");
  const message = "message" in first ? first.message : undefined;
  const content = message && typeof message === "object" && "content" in message ? message.content : undefined;
  if (typeof content !== "string" || content.length === 0) throw new Error("Model returned no action.");
  return content;
}

function present(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}
