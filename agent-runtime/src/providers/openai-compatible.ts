import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  Provider,
  ToolCall,
} from './types.ts';
import { ProviderError, withRetry } from './types.ts';

type WireMessage = Record<string, unknown>;

function toWire(messages: ChatMessage[]): WireMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    if (message.role === 'assistant') {
      const wire: WireMessage = { role: 'assistant', content: message.content || null };
      if (message.toolCalls?.length) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }));
      }
      return wire;
    }
    return { role: message.role, content: message.content };
  });
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { __unparsed: raw };
  }
}

/**
 * Shared client for the OpenAI chat-completions wire format, which xAI's Grok
 * API also speaks. Only the base URL, key and defaults differ.
 */
export function createOpenAiCompatibleProvider(options: {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}): Provider {
  return {
    id: options.id,
    label: options.label,
    defaultModel: options.defaultModel,
    async chat(messages: ChatMessage[], chatOptions: ChatOptions): Promise<ChatResult> {
      if (!options.apiKey) {
        throw new ProviderError(options.id, 401, 'missing API key');
      }

      const body: Record<string, unknown> = {
        model: chatOptions.model || options.defaultModel,
        messages: toWire(messages),
      };
      if (chatOptions.temperature !== undefined) body.temperature = chatOptions.temperature;
      if (chatOptions.maxTokens !== undefined) body.max_tokens = chatOptions.maxTokens;
      if (chatOptions.tools?.length) {
        body.tools = chatOptions.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        body.tool_choice = 'auto';
      }

      return withRetry(options.id, async () => {
        const response = await fetch(`${options.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: chatOptions.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new ProviderError(options.id, response.status, text.slice(0, 600));
        }

        const payload = JSON.parse(text) as {
          choices?: { message?: { content?: string; tool_calls?: unknown[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const message = payload.choices?.[0]?.message ?? {};
        const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((entry, index) => {
          const call = entry as {
            id?: string;
            function?: { name?: string; arguments?: string };
          };
          return {
            id: call.id ?? `call_${index}`,
            name: call.function?.name ?? 'unknown',
            args: parseArgs(call.function?.arguments),
          };
        });

        return {
          text: message.content ?? '',
          toolCalls,
          usage: {
            inputTokens: payload.usage?.prompt_tokens ?? 0,
            outputTokens: payload.usage?.completion_tokens ?? 0,
          },
        };
      });
    },
  };
}
