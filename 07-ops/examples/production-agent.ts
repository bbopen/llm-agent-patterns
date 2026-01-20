/**
 * production-agent.ts - Agent with Full Operations Stack
 *
 * Derivation:
 * - Netflix: "Design for failure with resilience patterns"
 * - SRE: "Observability and automation are not optional"
 * - Report 26: "Agents need infrastructure, not just intelligence"
 *
 * This demonstrates a production-ready agent configuration
 * with retry, circuit breaker, rate limiting, and observability.
 */

import { withRetry } from '../retry';
import { CircuitBreaker, createCircuitBreaker } from '../circuit-breaker';
import { RateLimiter, createRateLimiter } from '../rate-limiter';

// =============================================================================
// Types
// =============================================================================

/**
 * Operations configuration.
 */
export interface OpsConfig {
  /** Retry configuration */
  retry: {
    enabled: boolean;
    maxAttempts: number;
    baseDelay: number;
  };

  /** Circuit breaker configuration */
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeout: number;
  };

  /** Rate limiting configuration */
  rateLimiter: {
    enabled: boolean;
    maxTokens: number;
    refillRate: number;
  };

  /** Observability configuration */
  observability: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    metricsEnabled: boolean;
    tracingEnabled: boolean;
  };

  /** Health check configuration */
  healthCheck: {
    enabled: boolean;
    intervalMs: number;
  };
}

/**
 * Metrics collected by the agent.
 */
export interface AgentMetrics {
  /** Total LLM calls made */
  llmCalls: number;

  /** Total tool calls made */
  toolCalls: number;

  /** Total tokens consumed */
  tokensConsumed: number;

  /** Total errors */
  errors: number;

  /** Retries performed */
  retries: number;

  /** Circuit breaker trips */
  circuitTrips: number;

  /** Rate limit waits */
  rateLimitWaits: number;

  /** Total duration in ms */
  totalDurationMs: number;
}

/**
 * Log entry.
 */
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

/**
 * Health check result.
 */
export interface HealthCheck {
  healthy: boolean;
  checks: {
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs?: number;
    message?: string;
  }[];
  timestamp: number;
}

// =============================================================================
// Production Operations Wrapper
// =============================================================================

/**
 * Operations wrapper that adds resilience patterns to agent operations.
 *
 * Derivation (Defense in Depth):
 * "Layer multiple resilience patterns:
 * Rate limiting prevents overload,
 * Circuit breakers prevent cascade failures,
 * Retries handle transient errors,
 * Observability enables debugging."
 */
export class ProductionOps {
  private config: OpsConfig;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;
  private metrics: AgentMetrics;
  private logs: LogEntry[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<OpsConfig> = {}) {
    this.config = {
      retry: {
        enabled: true,
        maxAttempts: 3,
        baseDelay: 1000,
        ...config.retry,
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeout: 60000,
        ...config.circuitBreaker,
      },
      rateLimiter: {
        enabled: true,
        maxTokens: 60,
        refillRate: 1,
        ...config.rateLimiter,
      },
      observability: {
        logLevel: 'info',
        metricsEnabled: true,
        tracingEnabled: true,
        ...config.observability,
      },
      healthCheck: {
        enabled: true,
        intervalMs: 30000,
        ...config.healthCheck,
      },
    };

    // Initialize circuit breaker
    this.circuitBreaker = createCircuitBreaker('llm-api', {
      failureThreshold: this.config.circuitBreaker.failureThreshold,
      resetTimeout: this.config.circuitBreaker.resetTimeout,
      onStateChange: (from, to, reason) => {
        this.log('warn', `Circuit breaker: ${from} -> ${to} (${reason})`);
        if (to === 'open') {
          this.metrics.circuitTrips++;
        }
      },
    });

    // Initialize rate limiter
    this.rateLimiter = createRateLimiter('llm-api', {
      maxTokens: this.config.rateLimiter.maxTokens,
      refillRate: this.config.rateLimiter.refillRate,
      queueRequests: true,
    });

    // Initialize metrics
    this.metrics = {
      llmCalls: 0,
      toolCalls: 0,
      tokensConsumed: 0,
      errors: 0,
      retries: 0,
      circuitTrips: 0,
      rateLimitWaits: 0,
      totalDurationMs: 0,
    };
  }

  /**
   * Execute an LLM call with full ops stack.
   */
  async callLlm<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    try {
      // Rate limiting
      if (this.config.rateLimiter.enabled) {
        const tokensBefore = this.rateLimiter.getAvailableTokens();
        await this.rateLimiter.acquire();
        const _tokensAfter = this.rateLimiter.getAvailableTokens();

        if (tokensBefore === 0) {
          this.metrics.rateLimitWaits++;
          this.log('debug', 'Rate limiter: waited for token');
        }
      }

      // Circuit breaker + retry
      let result: T;

      if (this.config.circuitBreaker.enabled) {
        result = await this.circuitBreaker.call(async () => {
          if (this.config.retry.enabled) {
            return withRetry(fn, {
              maxAttempts: this.config.retry.maxAttempts,
              baseDelay: this.config.retry.baseDelay,
              onRetry: (error, attempt, delay) => {
                this.metrics.retries++;
                this.log('warn', `Retry ${attempt} after ${delay}ms: ${error}`);
              },
            });
          }
          return fn();
        });
      } else if (this.config.retry.enabled) {
        result = await withRetry(fn, {
          maxAttempts: this.config.retry.maxAttempts,
          baseDelay: this.config.retry.baseDelay,
          onRetry: (error, attempt, delay) => {
            this.metrics.retries++;
            this.log('warn', `Retry ${attempt} after ${delay}ms: ${error}`);
          },
        });
      } else {
        result = await fn();
      }

      this.metrics.llmCalls++;
      this.metrics.totalDurationMs += Date.now() - startTime;

      this.log('debug', 'LLM call completed', {
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.metrics.errors++;
      this.log('error', `LLM call failed: ${error}`);
      throw error;
    }
  }

  /**
   * Execute a tool call with metrics tracking.
   */
  async callTool<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();

      this.metrics.toolCalls++;
      this.log('debug', `Tool ${name} completed`, {
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.metrics.errors++;
      this.log('error', `Tool ${name} failed: ${error}`);
      throw error;
    }
  }

  /**
   * Record token consumption.
   */
  recordTokens(tokens: number): void {
    this.metrics.tokensConsumed += tokens;
  }

  /**
   * Log a message.
   */
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevel = levels.indexOf(this.config.observability.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel < currentLevel) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context,
    };

    this.logs.push(entry);

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }

    // Console output
    const prefix = `[${level.toUpperCase()}]`;
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    console.log(`${prefix} ${message}${contextStr}`);
  }

  /**
   * Get current metrics.
   */
  getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent logs.
   */
  getLogs(limit: number = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Perform a health check.
   */
  async checkHealth(): Promise<HealthCheck> {
    const checks: HealthCheck['checks'] = [];

    // Check circuit breaker
    const circuitState = this.circuitBreaker.getState();
    checks.push({
      name: 'circuit-breaker',
      status: circuitState === 'open' ? 'unhealthy' : 'healthy',
      message: `State: ${circuitState}`,
    });

    // Check rate limiter
    const rateLimiterStats = this.rateLimiter.getStats();
    checks.push({
      name: 'rate-limiter',
      status: rateLimiterStats.availableTokens > 0 ? 'healthy' : 'degraded',
      message: `Tokens: ${rateLimiterStats.availableTokens}`,
    });

    // Check error rate
    const errorRate = this.metrics.llmCalls > 0
      ? this.metrics.errors / this.metrics.llmCalls
      : 0;
    checks.push({
      name: 'error-rate',
      status: errorRate < 0.1 ? 'healthy' : errorRate < 0.25 ? 'degraded' : 'unhealthy',
      message: `Error rate: ${(errorRate * 100).toFixed(1)}%`,
    });

    return {
      healthy: checks.every(c => c.status === 'healthy'),
      checks,
      timestamp: Date.now(),
    };
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(callback?: (health: HealthCheck) => void): void {
    if (!this.config.healthCheck.enabled) return;

    this.healthCheckInterval = setInterval(async () => {
      const health = await this.checkHealth();
      if (callback) {
        callback(health);
      } else if (!health.healthy) {
        this.log('warn', 'Health check failed', { checks: health.checks });
      }
    }, this.config.healthCheck.intervalMs);
  }

  /**
   * Stop health checks and cleanup.
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  /**
   * Reset all metrics and state.
   */
  reset(): void {
    this.metrics = {
      llmCalls: 0,
      toolCalls: 0,
      tokensConsumed: 0,
      errors: 0,
      retries: 0,
      circuitTrips: 0,
      rateLimitWaits: 0,
      totalDurationMs: 0,
    };
    this.logs = [];
    this.circuitBreaker.reset();
    this.rateLimiter.reset();
  }
}

// =============================================================================
// Production Agent Wrapper
// =============================================================================

/**
 * Wrap an agent with production operations.
 *
 * @example
 * const ops = createProductionOps();
 *
 * // In agent loop:
 * const response = await ops.callLlm(() =>
 *   client.messages.create({ messages, tools })
 * );
 *
 * for (const toolCall of response.toolCalls) {
 *   const result = await ops.callTool(toolCall.name, () =>
 *     executeTool(toolCall)
 *   );
 * }
 *
 * ops.recordTokens(response.usage.total_tokens);
 */
export function createProductionOps(
  config?: Partial<OpsConfig>
): ProductionOps {
  return new ProductionOps(config);
}

// =============================================================================
// Pre-configured Production Configs
// =============================================================================

/**
 * Production configurations for common scenarios.
 */
export const ProductionConfigs = {
  /** Standard production configuration */
  standard: {
    retry: { enabled: true, maxAttempts: 3, baseDelay: 1000 },
    circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 },
    rateLimiter: { enabled: true, maxTokens: 60, refillRate: 1 },
    observability: { logLevel: 'info', metricsEnabled: true, tracingEnabled: true },
    healthCheck: { enabled: true, intervalMs: 30000 },
  } as Partial<OpsConfig>,

  /** High-availability configuration */
  highAvailability: {
    retry: { enabled: true, maxAttempts: 5, baseDelay: 500 },
    circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeout: 30000 },
    rateLimiter: { enabled: true, maxTokens: 100, refillRate: 2 },
    observability: { logLevel: 'debug', metricsEnabled: true, tracingEnabled: true },
    healthCheck: { enabled: true, intervalMs: 10000 },
  } as Partial<OpsConfig>,

  /** Cost-optimized configuration */
  costOptimized: {
    retry: { enabled: true, maxAttempts: 2, baseDelay: 2000 },
    circuitBreaker: { enabled: true, failureThreshold: 10, resetTimeout: 120000 },
    rateLimiter: { enabled: true, maxTokens: 30, refillRate: 0.5 },
    observability: { logLevel: 'warn', metricsEnabled: true, tracingEnabled: false },
    healthCheck: { enabled: true, intervalMs: 60000 },
  } as Partial<OpsConfig>,

  /** Development configuration */
  development: {
    retry: { enabled: false, maxAttempts: 1, baseDelay: 0 },
    circuitBreaker: { enabled: false, failureThreshold: 100, resetTimeout: 1000 },
    rateLimiter: { enabled: false, maxTokens: 1000, refillRate: 100 },
    observability: { logLevel: 'debug', metricsEnabled: true, tracingEnabled: true },
    healthCheck: { enabled: false, intervalMs: 0 },
  } as Partial<OpsConfig>,
};

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Running a production agent.
 *
 * ```typescript
 * import { createProductionOps, ProductionConfigs } from './production-agent';
 *
 * async function runProductionAgent(task: string) {
 *   // Create ops with production config
 *   const ops = createProductionOps(ProductionConfigs.standard);
 *
 *   // Start health checks
 *   ops.startHealthChecks((health) => {
 *     if (!health.healthy) {
 *       console.error('Agent unhealthy:', health.checks);
 *     }
 *   });
 *
 *   try {
 *     // Agent loop with ops protection
 *     while (true) {
 *       // LLM call with retry, circuit breaker, rate limiting
 *       const response = await ops.callLlm(async () => {
 *         return client.messages.create({
 *           model: 'claude-3-opus',
 *           messages,
 *           tools,
 *         });
 *       });
 *
 *       // Record token usage
 *       ops.recordTokens(response.usage.total_tokens);
 *
 *       // Check for completion
 *       if (!response.content.some(b => b.type === 'tool_use')) {
 *         break;
 *       }
 *
 *       // Execute tools
 *       for (const block of response.content) {
 *         if (block.type === 'tool_use') {
 *           await ops.callTool(block.name, async () => {
 *             return executeTool(block);
 *           });
 *         }
 *       }
 *     }
 *
 *     // Log final metrics
 *     ops.log('info', 'Agent completed', ops.getMetrics());
 *
 *   } finally {
 *     ops.shutdown();
 *   }
 * }
 * ```
 */

