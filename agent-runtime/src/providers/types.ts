export type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ChatResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
};

export type ChatOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
  signal?: AbortSignal;
};

export type Provider = {
  id: string;
  label: string;
  defaultModel: string;
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult>;
};

export class ProviderError extends Error {
  status: number;
  provider: string;

  constructor(provider: string, status: number, message: string) {
    super(`[${provider} ${status}] ${message}`);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
  }
}

/** Retries transient upstream failures; model/auth errors surface immediately. */
export async function withRetry<T>(
  label: string,
  run: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const status = error instanceof ProviderError ? error.status : 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === attempts - 1) break;
      await new Promise((done) => setTimeout(done, 1200 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}
