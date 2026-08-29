import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  Provider,
  ToolCall,
} from './types.ts';
import { ProviderError, withRetry } from './types.ts';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const SCHEMA_KEYS = new Set([
  'type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable',
]);

/** Gemini accepts an OpenAPI subset: unknown JSON Schema keywords are rejected. */
function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase();
    } else if (key === 'properties' && value && typeof value === 'object') {
      const properties: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = sanitizeSchema(schema);
      }
      out.properties = properties;
    } else if (key === 'items') {
      out.items = sanitizeSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

type Part = Record<string, unknown>;
type Content = { role: 'user' | 'model'; parts: Part[] };

function toContents(messages: ChatMessage[]): { system: string; contents: Content[] } {
  const systemChunks: string[] = [];
  const contents: Content[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemChunks.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      // Gemini returns tool output as user-role functionResponse parts; runs of
      // parallel tool results belong in a single content block.
      const part: Part = {
        functionResponse: {
          name: message.name,
          response: { result: message.content },
        },
      };
      const last = contents[contents.length - 1];
      if (last && last.role === 'user' && last.parts.every((entry) => 'functionResponse' in entry)) {
        last.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const parts: Part[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    contents.push({ role: 'user', parts: [{ text: message.content }] });
  }

  return { system: systemChunks.join('\n\n'), contents };
}

export function createGeminiProvider(options: {
  apiKey: string;
  defaultModel: string;
}): Provider {
  return {
    id: 'gemini',
    label: 'Gemini (Google)',
    defaultModel: options.defaultModel,
    async chat(messages: ChatMessage[], chatOptions: ChatOptions): Promise<ChatResult> {
      if (!options.apiKey) {
        throw new ProviderError('gemini', 401, 'missing API key');
      }

      const { system, contents } = toContents(messages);
      const model = chatOptions.model || options.defaultModel;
      const body: Record<string, unknown> = { contents };

      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (chatOptions.tools?.length) {
        body.tools = [{
          functionDeclarations: chatOptions.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: sanitizeSchema(tool.parameters),
          })),
        }];
      }
      const generationConfig: Record<string, unknown> = {};
      if (chatOptions.temperature !== undefined) generationConfig.temperature = chatOptions.temperature;
      if (chatOptions.maxTokens !== undefined) generationConfig.maxOutputTokens = chatOptions.maxTokens;
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

      return withRetry('gemini', async () => {
        const response = await fetch(`${BASE_URL}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey,
          },
          body: JSON.stringify(body),
          signal: chatOptions.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new ProviderError('gemini', response.status, text.slice(0, 600));
        }

        const payload = JSON.parse(text) as {
          candidates?: { content?: { parts?: Part[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };

        const parts = payload.candidates?.[0]?.content?.parts ?? [];
        const textChunks: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const part of parts) {
          if (typeof part.text === 'string') textChunks.push(part.text);
          const call = part.functionCall as { name?: string; args?: Record<string, unknown> } | undefined;
          if (call?.name) {
            toolCalls.push({
              id: `${call.name}_${toolCalls.length}`,
              name: call.name,
              args: call.args ?? {},
            });
          }
        }

        return {
          text: textChunks.join('\n'),
          toolCalls,
          usage: {
            inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
          },
        };
      });
    },
  };
}
