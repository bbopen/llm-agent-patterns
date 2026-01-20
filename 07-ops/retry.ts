/**
 * retry.ts - Exponential Backoff with Jitter
 *
 * Derivation:
 * - Netflix: "Design for failure. Assume everything will break."
 * - AWS: "Exponential backoff with jitter prevents thundering herds"
 * - Report 26: "Most 'agent failures' are infrastructure failures"
 *
 * Simple retries cause synchronized retry storms.
 * Exponential backoff with jitter distributes load.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Retry configuration.
 */
export interface RetryConfig {
  /** Maximum number of attempts (including initial) */
  maxAttempts: number;

  /** Base delay in milliseconds */
  baseDelay: number;

  /** Maximum delay in milliseconds */
  maxDelay: number;

  /** Multiplier for exponential backoff */
  multiplier?: number;

  /** Jitter factor (0-1) */
  jitterFactor?: number;

  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;

  /** Callback on each retry */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * Retry result with attempt information.
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalDelayMs: number;
}

// =============================================================================
// Default Retryable Errors
// =============================================================================

/**
 * HTTP status codes that are typically retryable.
 */
const RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

/**
 * Error messages that indicate retryable conditions.
 */
const RETRYABLE_PATTERNS = [
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /socket hang up/,
  /network/i,
  /timeout/i,
  /rate limit/i,
  /overloaded/i,
  /temporarily unavailable/i,
];

/**
 * Default function to determine if an error is retryable.
 */
export function defaultIsRetryable(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  // Check for HTTP status codes
  const status = (error as any)?.status || (error as any)?.statusCode;
  if (typeof status === 'number' && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }

  // Check for retryable error patterns
  const message = String(error);
  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }

  // Check for explicit retry flag
  if ((error as any)?.retryable === true) {
    return true;
  }

  return false;
}

// =============================================================================
// Delay Calculation
// =============================================================================

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * Derivation (AWS Best Practices):
 * "Add randomness (jitter) to prevent synchronized retries.
 * Exponential growth handles persistent failures efficiently."
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const multiplier = config.multiplier || 2;
  const jitterFactor = config.jitterFactor ?? 0.5;

  // Exponential backoff: baseDelay * multiplier^attempt
  const exponentialDelay = config.baseDelay * Math.pow(multiplier, attempt);

  // Add jitter: random factor between (1 - jitterFactor) and (1 + jitterFactor)
  const jitterMultiplier = 1 - jitterFactor + (Math.random() * 2 * jitterFactor);
  const jitteredDelay = exponentialDelay * jitterMultiplier;

  // Clamp to maxDelay
  return Math.min(Math.round(jitteredDelay), config.maxDelay);
}

// =============================================================================
// Retry Implementation
// =============================================================================

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic.
 *
 * Derivation (Distributed Systems):
 * "Transient failures are normal. Retry with exponential backoff
 * handles most transient issues automatically."
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
    jitterFactor: 0.5,
    isRetryable: defaultIsRetryable,
    ...config,
  };

  let lastError: unknown;
  let totalDelay = 0;

  for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt === fullConfig.maxAttempts - 1;
      const shouldRetry = fullConfig.isRetryable!(error);

      if (isLastAttempt || !shouldRetry) {
        throw error;
      }

      // Calculate and apply delay
      const delay = calculateDelay(attempt, fullConfig);
      totalDelay += delay;

      // Notify callback
      if (fullConfig.onRetry) {
        fullConfig.onRetry(error, attempt + 1, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Execute with retry and return detailed result.
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
    jitterFactor: 0.5,
    isRetryable: defaultIsRetryable,
    ...config,
  };

  let totalDelay = 0;
  let attempts = 0;

  for (let attempt = 0; attempt < fullConfig.maxAttempts; attempt++) {
    attempts++;

    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts,
        totalDelayMs: totalDelay,
      };
    } catch (error) {
      const isLastAttempt = attempt === fullConfig.maxAttempts - 1;
      const shouldRetry = fullConfig.isRetryable!(error);

      if (isLastAttempt || !shouldRetry) {
        return {
          success: false,
          error,
          attempts,
          totalDelayMs: totalDelay,
        };
      }

      const delay = calculateDelay(attempt, fullConfig);
      totalDelay += delay;

      if (fullConfig.onRetry) {
        fullConfig.onRetry(error, attempt + 1, delay);
      }

      await sleep(delay);
    }
  }

  // Should never reach here
  return {
    success: false,
    error: new Error('Unexpected retry loop exit'),
    attempts,
    totalDelayMs: totalDelay,
  };
}

// =============================================================================
// Retry Policies
// =============================================================================

/**
 * Pre-configured retry policies for common scenarios.
 */
export const RetryPolicies = {
  /** Conservative: Few retries, long backoff */
  conservative: {
    maxAttempts: 2,
    baseDelay: 2000,
    maxDelay: 30000,
    multiplier: 3,
  } as Partial<RetryConfig>,

  /** Standard: Balanced approach */
  standard: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
  } as Partial<RetryConfig>,

  /** Aggressive: More retries, shorter initial delay */
  aggressive: {
    maxAttempts: 5,
    baseDelay: 500,
    maxDelay: 30000,
    multiplier: 2,
  } as Partial<RetryConfig>,

  /** API rate limits: Long backoff for 429 errors */
  rateLimited: {
    maxAttempts: 5,
    baseDelay: 5000,
    maxDelay: 60000,
    multiplier: 2,
    isRetryable: (error: unknown) => {
      const status = (error as any)?.status || (error as any)?.statusCode;
      return status === 429 || defaultIsRetryable(error);
    },
  } as Partial<RetryConfig>,

  /** Idempotent operations: More aggressive retry */
  idempotent: {
    maxAttempts: 5,
    baseDelay: 500,
    maxDelay: 15000,
    multiplier: 1.5,
  } as Partial<RetryConfig>,
};

// =============================================================================
// Decorators
// =============================================================================

/**
 * Decorator for adding retry to class methods.
 */
export function Retryable(config: Partial<RetryConfig> = {}) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return withRetry(() => originalMethod.apply(this, args), config);
    };

    return descriptor;
  };
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Retrying LLM API calls.
 *
 * ```typescript
 * import { withRetry, RetryPolicies } from './retry';
 *
 * async function callLlm(messages: Message[]): Promise<Response> {
 *   return withRetry(
 *     async () => {
 *       const response = await fetch('https://api.anthropic.com/v1/messages', {
 *         method: 'POST',
 *         headers: { 'x-api-key': API_KEY },
 *         body: JSON.stringify({ messages }),
 *       });
 *
 *       if (!response.ok) {
 *         const error = new Error(`HTTP ${response.status}`);
 *         (error as any).status = response.status;
 *         throw error;
 *       }
 *
 *       return response.json();
 *     },
 *     {
 *       ...RetryPolicies.rateLimited,
 *       onRetry: (error, attempt, delay) => {
 *         console.log(`Retry ${attempt} after ${delay}ms: ${error}`);
 *       },
 *     }
 *   );
 * }
 * ```
 */

