/**
 * circuit-breaker.ts - Circuit Breaker Pattern
 *
 * Derivation:
 * - Netflix Hystrix: "Prevent cascade failures with circuit breakers"
 * - Release It!: "Circuit breakers are the fuse box for distributed systems"
 * - Report 26: "Infrastructure failures shouldn't crash agents"
 *
 * When a service fails repeatedly, stop calling it.
 * This prevents cascade failures and allows recovery.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Name for identification */
  name: string;

  /** Number of failures to trip the circuit */
  failureThreshold: number;

  /** Time in ms before attempting recovery */
  resetTimeout: number;

  /** Number of successes in half-open to close */
  successThreshold?: number;

  /** Function to determine if error counts as failure */
  isFailure?: (error: unknown) => boolean;

  /** Callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState, reason: string) => void;

  /** Timeout for individual calls */
  callTimeout?: number;
}

/**
 * Circuit breaker statistics.
 */
export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailure?: number;
  lastSuccess?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Error thrown when circuit is open.
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly remainingMs: number
  ) {
    super(`Circuit "${circuitName}" is open. Retry in ${remainingMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

/**
 * Circuit breaker for protecting against cascade failures.
 *
 * Derivation (Netflix):
 * "When a service is failing, continuing to call it:
 * 1. Wastes resources
 * 2. Increases load on the failing service
 * 3. Causes cascade failures
 * Circuit breakers prevent all three."
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailure = 0;
  private lastSuccess = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;

  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      successThreshold: 1,
      isFailure: () => true,
      onStateChange: () => {},
      callTimeout: 30000,
      ...config,
    };
  }

  /**
   * Execute a function with circuit breaker protection.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      const remainingMs = this.getRemainingResetTime();

      if (remainingMs > 0) {
        throw new CircuitOpenError(this.config.name, remainingMs);
      }

      // Reset timeout elapsed, try half-open
      this.transitionTo('half-open', 'Reset timeout elapsed');
    }

    this.totalCalls++;

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.config.isFailure(error)) {
        this.onFailure();
      }
      throw error;
    }
  }

  /**
   * Execute function with timeout.
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Circuit call timeout: ${this.config.callTimeout}ms`)),
          this.config.callTimeout
        )
      ),
    ]);
  }

  /**
   * Handle successful call.
   */
  private onSuccess(): void {
    this.successes++;
    this.totalSuccesses++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccess = Date.now();

    if (this.state === 'half-open') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed', 'Success threshold reached');
      }
    }
  }

  /**
   * Handle failed call.
   */
  private onFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailure = Date.now();

    if (this.state === 'half-open') {
      // Any failure in half-open goes back to open
      this.transitionTo('open', 'Failure in half-open state');
    } else if (this.state === 'closed') {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionTo('open', 'Failure threshold reached');
      }
    }
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state;
    this.state = newState;

    // Reset counters on state change
    if (newState === 'half-open') {
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures = 0;
    }

    this.config.onStateChange(oldState, newState, reason);
  }

  /**
   * Get remaining time until reset attempt.
   */
  private getRemainingResetTime(): number {
    if (this.state !== 'open') return 0;
    const elapsed = Date.now() - this.lastFailure;
    return Math.max(0, this.config.resetTimeout - elapsed);
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics.
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailure: this.lastFailure || undefined,
      lastSuccess: this.lastSuccess || undefined,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Manually reset the circuit.
   */
  reset(): void {
    this.transitionTo('closed', 'Manual reset');
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }

  /**
   * Force the circuit open.
   */
  trip(reason: string = 'Manual trip'): void {
    this.transitionTo('open', reason);
    this.lastFailure = Date.now();
  }

  /**
   * Check if circuit allows calls.
   */
  isCallAllowed(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return true;
    return this.getRemainingResetTime() <= 0;
  }
}

// =============================================================================
// Circuit Breaker Registry
// =============================================================================

/**
 * Registry for managing multiple circuit breakers.
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker.
   */
  getOrCreate(config: CircuitBreakerConfig): CircuitBreaker {
    const existing = this.breakers.get(config.name);
    if (existing) {
      return existing;
    }

    const breaker = new CircuitBreaker(config);
    this.breakers.set(config.name, breaker);
    return breaker;
  }

  /**
   * Get an existing circuit breaker.
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers.
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get stats for all circuit breakers.
   */
  getAllStats(): Map<string, CircuitStats> {
    const stats = new Map<string, CircuitStats>();
    for (const [name, breaker] of this.breakers) {
      stats.set(name, breaker.getStats());
    }
    return stats;
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// =============================================================================
// Pre-configured Circuit Breakers
// =============================================================================

/**
 * Pre-configured circuit breaker policies.
 */
export const CircuitPolicies = {
  /** Sensitive: Quick to trip, slow to recover */
  sensitive: {
    failureThreshold: 3,
    resetTimeout: 30000,
    successThreshold: 2,
  } as Partial<CircuitBreakerConfig>,

  /** Standard: Balanced approach */
  standard: {
    failureThreshold: 5,
    resetTimeout: 60000,
    successThreshold: 1,
  } as Partial<CircuitBreakerConfig>,

  /** Tolerant: Slow to trip, quick to recover */
  tolerant: {
    failureThreshold: 10,
    resetTimeout: 120000,
    successThreshold: 1,
  } as Partial<CircuitBreakerConfig>,

  /** External API: For unreliable external services */
  externalApi: {
    failureThreshold: 3,
    resetTimeout: 30000,
    successThreshold: 2,
    callTimeout: 10000,
  } as Partial<CircuitBreakerConfig>,
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a circuit breaker with defaults.
 */
export function createCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> = {}
): CircuitBreaker {
  return new CircuitBreaker({
    name,
    failureThreshold: 5,
    resetTimeout: 60000,
    ...config,
  });
}

/**
 * Create a global circuit breaker registry.
 */
export function createCircuitBreakerRegistry(): CircuitBreakerRegistry {
  return new CircuitBreakerRegistry();
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Protecting an API call with circuit breaker.
 *
 * ```typescript
 * import { createCircuitBreaker, CircuitOpenError } from './circuit-breaker';
 *
 * const llmCircuit = createCircuitBreaker('llm-api', {
 *   failureThreshold: 3,
 *   resetTimeout: 30000,
 *   onStateChange: (from, to, reason) => {
 *     console.log(`Circuit ${from} -> ${to}: ${reason}`);
 *   },
 * });
 *
 * async function callLlm(messages: Message[]): Promise<Response> {
 *   try {
 *     return await llmCircuit.call(async () => {
 *       const response = await fetch('https://api.anthropic.com/v1/messages', {
 *         method: 'POST',
 *         body: JSON.stringify({ messages }),
 *       });
 *
 *       if (!response.ok) {
 *         throw new Error(`HTTP ${response.status}`);
 *       }
 *
 *       return response.json();
 *     });
 *   } catch (error) {
 *     if (error instanceof CircuitOpenError) {
 *       // Circuit is open - use fallback or fail fast
 *       console.log(`LLM circuit open, retry in ${error.remainingMs}ms`);
 *       throw new Error('LLM service temporarily unavailable');
 *     }
 *     throw error;
 *   }
 * }
 * ```
 */

