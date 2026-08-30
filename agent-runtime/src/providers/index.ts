import { env } from '../env.ts';
import { PROVIDER_LABELS } from '../config.ts';
import type { ProviderId } from '../types.ts';
import { createGeminiProvider } from './gemini.ts';
import { createOpenAiCompatibleProvider } from './openai-compatible.ts';
import type { Provider } from './types.ts';

export function getProvider(id: ProviderId): Provider {
  if (id === 'openai') {
    return createOpenAiCompatibleProvider({
      id: 'openai',
      label: PROVIDER_LABELS.openai,
      baseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      apiKey: env('OPENAI_API_KEY'),
      defaultModel: env('OPENAI_MODEL', 'gpt-4.1'),
    });
  }

  if (id === 'xai') {
    return createOpenAiCompatibleProvider({
      id: 'xai',
      label: PROVIDER_LABELS.xai,
      baseUrl: env('XAI_BASE_URL', 'https://api.x.ai/v1'),
      apiKey: env('XAI_API_KEY'),
      defaultModel: env('XAI_MODEL', 'grok-4'),
    });
  }

  if (id === 'gemini') {
    return createGeminiProvider({
      apiKey: env('GEMINI_API_KEY'),
      defaultModel: env('GEMINI_MODEL', 'gemini-3.1-pro-preview'),
    });
  }

  throw new Error(`Unknown provider: ${id as string}`);
}

export type { Provider } from './types.ts';
