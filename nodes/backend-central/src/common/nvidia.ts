/**
 * Cliente mínimo para la API de NVIDIA (NIM, OpenAI-compatible).
 * Reemplaza a Gemini en las funciones de IA del backend (texto y visión).
 *
 * Endpoint: https://integrate.api.nvidia.com/v1/chat/completions
 * Auth: Bearer <NVIDIA_API_KEY> (claves "nvapi-...").
 *
 * Nota: los modelos Nemotron son de RAZONAMIENTO — emiten `reasoning` antes del
 * `content`. Con pocos `max_tokens` se quedan "pensando" y devuelven `content`
 * vacío (`finish_reason: length`). Por eso usamos un presupuesto de tokens amplio
 * y validamos que el `content` no venga vacío.
 */

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/** Parte de un mensaje multimodal (texto o imagen). */
export interface NvidiaContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface NvidiaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | NvidiaContentPart[];
}

export interface NvidiaChatOptions {
  apiKey: string;
  model: string;
  messages: NvidiaMessage[];
  /** Amplio por defecto: los modelos de razonamiento consumen tokens "pensando". */
  maxTokens?: number;
  temperature?: number;
}

/** Llama a la API de chat de NVIDIA y devuelve el texto de la respuesta. */
export async function callNvidiaChat(opts: NvidiaChatOptions): Promise<string> {
  const response = await fetch(NVIDIA_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`NVIDIA API returned status ${response.status}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error('NVIDIA API devolvió respuesta vacía (probablemente agotó max_tokens en el razonamiento).');
  }
  return content;
}

/**
 * Extrae el primer objeto JSON de un texto. Tolera fences ```json y prosa antes
 * o después del JSON (útil porque los modelos de razonamiento a veces añaden texto).
 */
export function extractJson(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return JSON.parse(text);
}
