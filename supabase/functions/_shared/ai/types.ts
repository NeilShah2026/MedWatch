/** Provider-agnostic interface for the (server-side only) AI model call (spec §7.5). */
export interface AiRequest {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type AiErrorKind = 'timeout' | 'http' | 'network' | 'bad_response';

export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    public readonly httpStatus?: number,
  ) {
    super(`ai_${kind}${httpStatus ? `_${httpStatus}` : ''}`);
    this.name = 'AiError';
  }
}

export interface AiProvider {
  readonly name: 'gateway' | 'mock';
  readonly model: string;
  complete(req: AiRequest): Promise<AiResponse>;
}
