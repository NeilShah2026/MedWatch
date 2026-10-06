import { supabase } from './supabase';
import { logger } from './logger';

/** Call an Edge Function with the signed-in user's token. Bodies carry IDs only. */
export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    logger.warn('function.invoke_failed', { route: name });
    throw new Error('function-failed');
  }
  return data as T;
}

/** Fire-and-forget follow-up (e.g. re-run the flag engine after a save). */
export function triggerFunction(name: string, body: Record<string, unknown>): void {
  void invokeFunction(name, body).catch(() => undefined);
}
