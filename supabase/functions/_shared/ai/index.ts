import { AnthropicGatewayProvider } from './anthropic.ts';
import { MockAiProvider } from './mock.ts';
import type { AiProvider } from './types.ts';

export * from './types.ts';
export { AnthropicGatewayProvider } from './anthropic.ts';
export { MockAiProvider, type MockMode } from './mock.ts';

export interface AiEnv {
  AI_ENABLED: string;
  AI_PROVIDER: 'gateway' | 'mock';
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_AUTH_HEADER?: string;
  AI_MODEL?: string;
}

/** null when AI is disabled → callers use the rules builder (spec §7.5). */
export function createAiProvider(env: AiEnv): AiProvider | null {
  if (env.AI_ENABLED !== 'true') return null;
  if (env.AI_PROVIDER === 'gateway') {
    if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_API_KEY) return null;
    return new AnthropicGatewayProvider({
      url: env.AI_GATEWAY_URL,
      apiKey: env.AI_GATEWAY_API_KEY,
      authHeader: env.AI_GATEWAY_AUTH_HEADER,
      model: env.AI_MODEL,
    });
  }
  return new MockAiProvider('valid');
}
