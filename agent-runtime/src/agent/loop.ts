import type { Provider } from '../providers/index.ts';
import type { ChatMessage, ToolSchema } from '../providers/types.ts';
import { TOOL_SCHEMAS, runTool } from './tools.ts';
import type { ToolContext } from './tools.ts';

export type LoopEvent = {
  kind: 'model' | 'tool' | 'log' | 'error';
  title: string;
  detail?: string;
};

export type LoopResult = {
  finished: boolean;
  summary: string;
  iterations: number;
  usage: { calls: number; inputTokens: number; outputTokens: number };
};

/**
 * Drops the bodies of older tool results once the transcript grows. Keeps the
 * instructions and the recent working set, which is what the model reasons over.
 */
function compact(messages: ChatMessage[], keepRecent: number): ChatMessage[] {
  if (messages.length <= keepRecent + 2) return messages;
  const head = messages.slice(0, 2);
  const middle = messages.slice(2, messages.length - keepRecent).map((message) =>
    message.role === 'tool' && message.content.length > 400
      ? { ...message, content: `[older ${message.name} output elided, ${message.content.length} chars]` }
      : message,
  );
  return [...head, ...middle, ...messages.slice(messages.length - keepRecent)];
}

function preview(text: string, limit = 220): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export async function runAgentLoop(options: {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  toolContext: ToolContext;
  maxIterations: number;
  tools?: ToolSchema[];
  signal?: AbortSignal;
  onEvent: (event: LoopEvent) => void;
}): Promise<LoopResult> {
  const { provider, model, toolContext, maxIterations, onEvent, signal } = options;
  const tools = options.tools ?? TOOL_SCHEMAS;
  const messages = [...options.messages];
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  let iterations = 0;
  let idleTurns = 0;

  while (iterations < maxIterations) {
    if (signal?.aborted) throw new Error('cancelled');
    iterations += 1;

    const result = await provider.chat(compact(messages, 14), {
      model,
      tools,
      temperature: 0.1,
      signal,
    });

    usage.calls += 1;
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    if (result.text.trim()) {
      onEvent({ kind: 'model', title: preview(result.text), detail: result.text });
    }

    messages.push({
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    });

    if (!result.toolCalls.length) {
      idleTurns += 1;
      if (idleTurns >= 2) {
        return {
          finished: false,
          summary: result.text || 'The agent stopped without calling finish.',
          iterations,
          usage,
        };
      }
      messages.push({
        role: 'user',
        content:
          'Keep going using the tools. If the work is complete and verified, call the `finish` tool; ' +
          'if you are blocked, call `finish` and explain why.',
      });
      continue;
    }

    idleTurns = 0;

    for (const call of result.toolCalls) {
      if (signal?.aborted) throw new Error('cancelled');

      const label = call.name === 'run_command'
        ? `run_command: ${String(call.args.command ?? '')}`
        : call.name === 'finish'
          ? 'finish'
          : `${call.name}: ${String(call.args.path ?? call.args.query ?? '')}`;

      const outcome = await runTool(toolContext, call.name, call.args);

      onEvent({
        kind: outcome.isError ? 'error' : 'tool',
        title: label,
        detail: outcome.output,
      });

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: outcome.output,
      });

      if (outcome.finished) {
        return { finished: true, summary: outcome.summary ?? '', iterations, usage };
      }
    }
  }

  return {
    finished: false,
    summary: `Reached the ${maxIterations}-step limit without finishing.`,
    iterations,
    usage,
  };
}
