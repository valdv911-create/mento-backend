import { AI_CONFIG } from './aiConfig';
import { retryWithBackoff, RetryOptions } from '../../lib/resilience';

export async function retryGeminiCall<T>(operation: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
  return retryWithBackoff(operation, {
    retries: options.retries ?? AI_CONFIG.MAX_RETRIES,
    baseDelayMs: options.baseDelayMs ?? AI_CONFIG.RETRY_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? AI_CONFIG.RETRY_DELAY_MS * 2,
    timeoutMs: options.timeoutMs ?? AI_CONFIG.GEMINI_TIMEOUT_MS,
    retryableStatusCodes: options.retryableStatusCodes,
    shouldRetry: options.shouldRetry,
  });
}
