import { AiError, type AiProvider, type AiRequest, type AiResponse } from './types.ts';

export interface GatewayConfig {
  url: string;
  apiKey: string;
  authHeader?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Calls a user-provided gateway that speaks the Anthropic Messages API:
 * POST {AI_GATEWAY_URL}/v1/messages with `anthropic-version: 2023-06-01`.
 * If a gateway uses another format, adapt only this class (and log it in DECISIONS.md).
 * Never logs request or response bodies.
 */
export class AnthropicGatewayProvider implements AiProvider {
  readonly name = 'gateway' as const;
  readonly model: string;
  private readonly cfg: Required<Omit<GatewayConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(cfg: GatewayConfig) {
    this.model = cfg.model ?? 'claude-sonnet-5-5';
    this.cfg = {
      url: cfg.url.replace(/\/$/, ''),
      apiKey: cfg.apiKey,
      authHeader: cfg.authHeader ?? 'x-api-key',
      model: this.model,
      fetchImpl: cfg.fetchImpl ?? fetch,
    };
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await this.cfg.fetchImpl(`${this.cfg.url}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          [this.cfg.authHeader]: this.cfg.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === 'AbortError' || controller.signal.aborted)
        throw new AiError('timeout');
      throw new AiError('network');
    }
    try {
      if (!res.ok) throw new AiError('http', res.status);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        if (controller.signal.aborted) throw new AiError('timeout');
        throw new AiError('bad_response');
      }
      const b = body as {
        content?: { type: string; text?: string }[];
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (b.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      if (!text) throw new AiError('bad_response');
      return {
        text,
        model: b.model ?? this.model,
        inputTokens: b.usage?.input_tokens ?? null,
        outputTokens: b.usage?.output_tokens ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
