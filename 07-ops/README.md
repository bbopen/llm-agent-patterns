# Operations

**Principle**: Agents need infrastructure, not just intelligence. Retries, circuit breakers, rate limiting, and observability are not optional in production.

---

## The Derivation

### From Distributed Systems

Production systems fail. Networks timeout. APIs rate limit. Services crash.

**Netflix (2010s)** pioneered resilience patterns:
> "The cloud is not reliable. Design for failure. Assume everything will break."

Applied to agents:
- LLM APIs have rate limits and outages
- Tool executions can timeout or fail
- External services are unreliable
- Recovery must be automatic

### From Production Experience (Reports 26, 28)

**Report 26** observed:
> "Agents that work in demos die in production. The difference is infrastructure."

**Report 28** emphasized:
> "Ops vs agent distinction matters. Most 'agent failures' are infrastructure failures."

The insight: An agent without retry logic isn't production-ready. An agent without observability can't be debugged.

### From Site Reliability Engineering

SRE principles apply directly:
- **Error budgets**: Accept some failures, optimize for recovery
- **Gradual rollouts**: Test changes incrementally
- **Observability**: Logs, metrics, traces for everything
- **Automation**: Human intervention shouldn't be required for recovery

---

## Pattern 1: Exponential Backoff with Jitter

### The Problem

Simple retry logic causes thundering herds:

```typescript
// BAD: All retries hit at the same time
for (let i = 0; i < 3; i++) {
  try {
    return await callApi();
  } catch {
    await sleep(1000);  // Everyone retries after exactly 1s
  }
}
```

### The Solution

Exponential backoff with jitter spreads retries:

```typescript
// GOOD: Distributed retry timing
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt === config.maxAttempts - 1) {
        throw error;
      }

      // Exponential backoff with jitter
      const baseDelay = config.baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * config.baseDelay;
      const delay = Math.min(baseDelay + jitter, config.maxDelay);

      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

---

## Pattern 2: Circuit Breaker

### The Problem

Failing services can cascade failures:

```typescript
// BAD: Keep hammering a dead service
for (const request of requests) {
  try {
    await callDeadService();  // Always fails, wastes resources
  } catch {
    // Log and continue... but service is down!
  }
}
```

### The Solution

Circuit breakers prevent cascade failures:

```typescript
// GOOD: Stop calling when service is down
class CircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private lastFailure = 0;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}
```

States:
- **Closed**: Normal operation, requests pass through
- **Open**: Too many failures, fail fast without calling
- **Half-Open**: Testing if service recovered

---

## Pattern 3: Rate Limiting

### The Problem

Agents can generate unbounded load:

```typescript
// BAD: No rate limiting
while (tasksRemaining) {
  await processTask();  // Unlimited rate
}
// Result: API rate limits, cost explosion
```

### The Solution

Rate limiters control throughput:

```typescript
// GOOD: Controlled throughput
class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number  // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(tokens: number = 1): Promise<void> {
    this.refill();

    while (this.tokens < tokens) {
      const waitTime = (tokens - this.tokens) / this.refillRate * 1000;
      await sleep(waitTime);
      this.refill();
    }

    this.tokens -= tokens;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;
  }
}
```

---

## Pattern 4: Health Checks

### The Problem

Silent failures go unnoticed:

```typescript
// BAD: No visibility into system health
const agent = new Agent();
agent.run();  // Is it working? Who knows!
```

### The Solution

Explicit health checks and metrics:

```typescript
interface HealthStatus {
  healthy: boolean;
  checks: {
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs?: number;
    message?: string;
  }[];
  timestamp: number;
}

async function checkHealth(agent: Agent): Promise<HealthStatus> {
  const checks = await Promise.all([
    checkLlmConnection(),
    checkToolAvailability(),
    checkResourceUsage(),
  ]);

  return {
    healthy: checks.every(c => c.status === 'healthy'),
    checks,
    timestamp: Date.now(),
  };
}
```

---

## Pattern 5: Graceful Degradation

### The Problem

Partial failures shouldn't crash everything:

```typescript
// BAD: One failure kills the whole system
const results = await Promise.all(tasks.map(processTask));
// If any task fails, all fail
```

### The Solution

Graceful degradation preserves partial functionality:

```typescript
// GOOD: Partial success is still success
const results = await Promise.allSettled(tasks.map(processTask));

const successes = results.filter(r => r.status === 'fulfilled');
const failures = results.filter(r => r.status === 'rejected');

if (failures.length > 0) {
  log.warn(`${failures.length}/${results.length} tasks failed`);
}

// Continue with successful results
return successes.map(r => r.value);
```

---

## Observability Stack

### Logging

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context: {
    sessionId: string;
    iteration: number;
    toolName?: string;
  };
  metadata?: Record<string, unknown>;
}
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `agent.iterations` | Counter | Total iterations |
| `agent.tool_calls` | Counter | Tool calls by name |
| `agent.tokens_used` | Counter | Total tokens consumed |
| `agent.duration_ms` | Histogram | Execution duration |
| `agent.errors` | Counter | Errors by type |
| `agent.success_rate` | Gauge | Rolling success rate |

### Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Error Rate | >10% errors in 5min | Warning |
| Circuit Open | Any circuit breaker open | Warning |
| Token Budget Exceeded | >90% of budget used | Critical |
| Long Running Task | Task >5min | Warning |

---

## Trade-offs

### Retry Aggressiveness

| Setting | Behavior | Use Case |
|---------|----------|----------|
| Conservative | 2 retries, long backoff | Rate-limited APIs |
| Standard | 3 retries, medium backoff | Most production use |
| Aggressive | 5 retries, short backoff | Critical operations |

### Circuit Breaker Sensitivity

| Setting | Threshold | Reset Time | Use Case |
|---------|-----------|------------|----------|
| Sensitive | 3 failures | 30s | External APIs |
| Standard | 5 failures | 60s | Internal services |
| Tolerant | 10 failures | 120s | Known-flaky services |

---

## Files in This Section

- `retry.ts`: Exponential backoff implementation
- `circuit-breaker.ts`: Circuit breaker pattern
- `rate-limiter.ts`: Token bucket rate limiter
- `examples/production-agent.ts`: Agent with full ops stack

---

## Further Reading

- **Report 26**: The Simple Architecture (ops requirements)
- **Netflix Blog**: Resilience patterns
- **Google SRE Book**: Chapters on error budgets and monitoring
- **Release It!**: Michael Nygard's stability patterns

