/**
 * rate-limiter.ts - Token Bucket Rate Limiter
 *
 * Derivation:
 * - API Management: "Rate limiting prevents abuse and controls costs"
 * - Report 26: "Agents can generate unbounded load without limits"
 * - AWS/GCP: "Token bucket allows bursts while maintaining average rate"
 *
 * Rate limiting controls throughput to prevent API rate limit errors,
 * control costs, and protect downstream services.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Rate limiter configuration.
 */
export interface RateLimiterConfig {
  /** Maximum tokens in the bucket */
  maxTokens: number;

  /** Tokens added per second */
  refillRate: number;

  /** Name for identification */
  name?: string;

  /** Whether to queue requests or reject */
  queueRequests?: boolean;

  /** Maximum queue size (if queueing enabled) */
  maxQueueSize?: number;

  /** Maximum wait time in ms (if queueing enabled) */
  maxWaitTime?: number;
}

/**
 * Rate limiter statistics.
 */
export interface RateLimiterStats {
  availableTokens: number;
  totalRequests: number;
  totalGranted: number;
  totalRejected: number;
  totalWaitTimeMs: number;
  queueSize: number;
}

/**
 * Error thrown when rate limit exceeded.
 */
export class RateLimitExceededError extends Error {
  constructor(
    public readonly limiterName: string,
    public readonly retryAfterMs: number
  ) {
    super(`Rate limit exceeded for "${limiterName}". Retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitExceededError';
  }
}

// =============================================================================
// Token Bucket Implementation
// =============================================================================

/**
 * Token bucket rate limiter.
 *
 * Derivation (Token Bucket Algorithm):
 * "A bucket holds tokens up to a maximum capacity.
 * Tokens are added at a constant rate.
 * Requests consume tokens; if none available, wait or reject."
 *
 * Benefits:
 * - Allows bursts up to bucket size
 * - Maintains average rate over time
 * - Simple and efficient
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private config: Required<RateLimiterConfig>;

  // Statistics
  private totalRequests = 0;
  private totalGranted = 0;
  private totalRejected = 0;
  private totalWaitTimeMs = 0;

  // Queue management
  private queue: Array<{
    tokens: number;
    resolve: () => void;
    reject: (error: Error) => void;
    deadline: number;
  }> = [];

  constructor(config: RateLimiterConfig) {
    this.config = {
      name: 'default',
      queueRequests: true,
      maxQueueSize: 100,
      maxWaitTime: 30000,
      ...config,
    };

    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire tokens from the bucket.
   *
   * @param tokens Number of tokens to acquire (default: 1)
   * @returns Promise that resolves when tokens are acquired
   * @throws RateLimitExceededError if not queueing and no tokens available
   */
  async acquire(tokens: number = 1): Promise<void> {
    this.totalRequests++;
    this.refill();

    // Check if tokens are available immediately
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.totalGranted++;
      return;
    }

    // Not enough tokens - queue or reject
    if (!this.config.queueRequests) {
      this.totalRejected++;
      const retryAfter = this.calculateWaitTime(tokens);
      throw new RateLimitExceededError(this.config.name, retryAfter);
    }

    // Check queue limits
    if (this.queue.length >= this.config.maxQueueSize) {
      this.totalRejected++;
      throw new RateLimitExceededError(
        this.config.name,
        this.calculateWaitTime(tokens)
      );
    }

    // Wait for tokens
    const waitTime = await this.waitForTokens(tokens);
    this.totalWaitTimeMs += waitTime;
    this.totalGranted++;
  }

  /**
   * Try to acquire tokens without waiting.
   *
   * @returns true if tokens were acquired, false otherwise
   */
  tryAcquire(tokens: number = 1): boolean {
    this.totalRequests++;
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.totalGranted++;
      return true;
    }

    this.totalRejected++;
    return false;
  }

  /**
   * Wait for tokens to become available.
   */
  private waitForTokens(tokens: number): Promise<number> {
    const startTime = Date.now();
    const deadline = startTime + this.config.maxWaitTime;

    return new Promise((resolve, reject) => {
      const queueEntry = {
        tokens,
        resolve: () => resolve(Date.now() - startTime),
        reject,
        deadline,
      };

      this.queue.push(queueEntry);
      this.processQueue();
    });
  }

  /**
   * Process queued requests.
   */
  private processQueue(): void {
    if (this.queue.length === 0) return;

    this.refill();

    // Process requests in order
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      if (!entry) break;

      // Check deadline
      if (Date.now() > entry.deadline) {
        this.queue.shift();
        entry.reject(new RateLimitExceededError(
          this.config.name,
          this.calculateWaitTime(entry.tokens)
        ));
        continue;
      }

      // Check if enough tokens
      if (this.tokens >= entry.tokens) {
        this.queue.shift();
        this.tokens -= entry.tokens;
        entry.resolve();
      } else {
        // Not enough tokens, schedule retry
        const waitTime = this.calculateWaitTime(entry.tokens);
        setTimeout(() => this.processQueue(), Math.min(waitTime, 100));
        break;
      }
    }
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // in seconds
    const tokensToAdd = elapsed * this.config.refillRate;

    this.tokens = Math.min(
      this.config.maxTokens,
      this.tokens + tokensToAdd
    );
    this.lastRefill = now;
  }

  /**
   * Calculate wait time for a number of tokens.
   */
  private calculateWaitTime(tokens: number): number {
    this.refill();
    const deficit = tokens - this.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil((deficit / this.config.refillRate) * 1000);
  }

  /**
   * Get available tokens.
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get statistics.
   */
  getStats(): RateLimiterStats {
    this.refill();
    return {
      availableTokens: this.tokens,
      totalRequests: this.totalRequests,
      totalGranted: this.totalGranted,
      totalRejected: this.totalRejected,
      totalWaitTimeMs: this.totalWaitTimeMs,
      queueSize: this.queue.length,
    };
  }

  /**
   * Reset the rate limiter.
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    this.totalRequests = 0;
    this.totalGranted = 0;
    this.totalRejected = 0;
    this.totalWaitTimeMs = 0;
    this.queue = [];
  }
}

// =============================================================================
// Composite Rate Limiter
// =============================================================================

/**
 * Composite rate limiter that enforces multiple limits.
 *
 * Use when you need both per-second and per-minute limits.
 */
export class CompositeRateLimiter {
  private limiters: RateLimiter[] = [];

  /**
   * Add a rate limiter.
   */
  addLimiter(limiter: RateLimiter): this {
    this.limiters.push(limiter);
    return this;
  }

  /**
   * Acquire tokens from all limiters.
   */
  async acquire(tokens: number = 1): Promise<void> {
    // Acquire from all limiters
    // Note: Rollback is not possible with token bucket
    // The tokens are consumed even if later limiters fail
    for (const limiter of this.limiters) {
      await limiter.acquire(tokens);
    }
  }

  /**
   * Try to acquire from all limiters without waiting.
   */
  tryAcquire(tokens: number = 1): boolean {
    // Check all limiters first
    for (const limiter of this.limiters) {
      if (limiter.getAvailableTokens() < tokens) {
        return false;
      }
    }

    // Acquire from all
    for (const limiter of this.limiters) {
      limiter.tryAcquire(tokens);
    }

    return true;
  }
}

// =============================================================================
// Pre-configured Rate Limiters
// =============================================================================

/**
 * Common rate limit configurations.
 */
export const RateLimitPolicies = {
  /** Anthropic API: 60 requests per minute */
  anthropicApi: {
    maxTokens: 60,
    refillRate: 1, // 1 token per second = 60 per minute
    queueRequests: true,
    maxWaitTime: 60000,
  } as RateLimiterConfig,

  /** OpenAI API: 60 requests per minute with burst */
  openaiApi: {
    maxTokens: 20, // Allow burst of 20
    refillRate: 1, // 1 token per second = 60 per minute
    queueRequests: true,
    maxWaitTime: 30000,
  } as RateLimiterConfig,

  /** Conservative: Low rate for expensive operations */
  conservative: {
    maxTokens: 5,
    refillRate: 0.5, // 30 per minute
    queueRequests: true,
    maxWaitTime: 60000,
  } as RateLimiterConfig,

  /** Aggressive: High rate for cheap operations */
  aggressive: {
    maxTokens: 100,
    refillRate: 10, // 600 per minute
    queueRequests: false,
  } as RateLimiterConfig,
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a rate limiter.
 */
export function createRateLimiter(
  name: string,
  config: Partial<RateLimiterConfig> = {}
): RateLimiter {
  return new RateLimiter({
    name,
    maxTokens: 60,
    refillRate: 1,
    ...config,
  });
}

/**
 * Create a composite rate limiter with per-second and per-minute limits.
 */
export function createTimedRateLimiter(
  name: string,
  perSecond: number,
  perMinute: number
): CompositeRateLimiter {
  return new CompositeRateLimiter()
    .addLimiter(new RateLimiter({
      name: `${name}-per-second`,
      maxTokens: perSecond,
      refillRate: perSecond,
      queueRequests: true,
      maxWaitTime: 2000,
    }))
    .addLimiter(new RateLimiter({
      name: `${name}-per-minute`,
      maxTokens: perMinute,
      refillRate: perMinute / 60,
      queueRequests: true,
      maxWaitTime: 60000,
    }));
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Rate limiting LLM API calls.
 *
 * ```typescript
 * import { createRateLimiter, RateLimitPolicies } from './rate-limiter';
 *
 * const llmLimiter = createRateLimiter('llm-api', RateLimitPolicies.anthropicApi);
 *
 * async function callLlm(messages: Message[]): Promise<Response> {
 *   // Wait for rate limit token
 *   await llmLimiter.acquire();
 *
 *   // Make the API call
 *   return fetch('https://api.anthropic.com/v1/messages', {
 *     method: 'POST',
 *     body: JSON.stringify({ messages }),
 *   });
 * }
 *
 * // Check stats periodically
 * setInterval(() => {
 *   const stats = llmLimiter.getStats();
 *   console.log(`Rate limiter: ${stats.availableTokens} tokens available`);
 *   console.log(`Granted: ${stats.totalGranted}, Rejected: ${stats.totalRejected}`);
 * }, 10000);
 * ```
 */

