# Evaluation

**Principle**: Test distributions, not assertions. Stochastic systems require statistical evaluation. Single-run tests prove nothing.

---

## The Derivation

### From Statistical Theory (Fisher, 1925)

**R.A. Fisher** established in "Statistical Methods for Research Workers":
> "The null hypothesis is never proved or established, but is possibly disproved... Every experiment may be said to exist only in order to give the facts a chance of disproving the null hypothesis."

Applied to agents:
- A single successful run doesn't prove reliability
- A single failure doesn't prove a bug
- Only repeated trials under controlled conditions yield knowledge

Traditional testing uses assertions:
```typescript
expect(result).toBe(expected);  // Pass or fail
```

For deterministic systems, this works. For stochastic systems, it's meaningless. Statistical evaluation tests distributions:
```typescript
const results = await runN(100, task);
const successRate = results.filter(r => r.success).length / 100;
expect(successRate).toBeGreaterThan(0.8);  // 80%+ success rate
```

### From Quality Control (Deming, 1986)

**W. Edwards Deming** in "Out of the Crisis" emphasized:
> "In God we trust, all others must bring data."

And critically:
> "Variation is the enemy of quality. Understanding variation distinguishes signal from noise."

For agents:
- Success rates have natural variation
- Some variation is inherent (common cause)
- Some variation indicates problems (special cause)
- Statistical process control separates the two

### From ML Evaluation (Dietterich, 1998)

**Thomas Dietterich** in "Approximate Statistical Tests for Comparing Supervised Classification Learning Algorithms" warned:
> "The choice of comparison methodology can determine whether a new algorithm is judged superior... Flawed methods can lead to erroneous conclusions."

Applied to agents:
- Single test/train splits are insufficient
- Confidence intervals must accompany point estimates
- Comparison requires proper statistical tests

### From Production Experience (Report 26)

**Report 26** observed:
> "Agents are 60-70% reliable per step. Single-run tests pass sometimes, fail sometimes. This tells you nothing."

The insight: An agent that passes 70% of the time isn't broken—it's behaving exactly as expected. Your tests need to account for this.

### From Scientific Method

Good experiments are:
- **Repeatable**: Same setup produces comparable results
- **Measurable**: Quantitative metrics, not subjective judgment
- **Comparable**: Results can be compared across versions

Agent evaluation requires:
- Multiple runs per test case
- Statistical aggregation
- Confidence intervals
- Trend tracking over time

---

## Pattern 1: Statistical Evaluation

### The Problem

Single-run tests for stochastic systems are noise:

```typescript
// BAD: Single-run test
test('agent completes task', async () => {
  const result = await runAgent('do something');
  expect(result.success).toBe(true);  // Flaky!
});
```

### The Solution

Test with statistical aggregation:

```typescript
// GOOD: Statistical test
test('agent completes task >80% of time', async () => {
  const results = await runEvaluation({
    task: 'do something',
    runs: 50,
    timeout: 30000,
  });

  expect(results.successRate).toBeGreaterThan(0.8);
  expect(results.variance).toBeLessThan(0.1);
});
```

---

## Pattern 2: Trace Capture

### The Problem

When an agent fails, you need to understand why. Without traces:
- No visibility into reasoning
- No way to compare successful vs failed runs
- No data for improvement

### The Solution

Capture complete execution traces:

```typescript
interface ExecutionTrace {
  id: string;
  task: string;
  success: boolean;
  iterations: TraceIteration[];
  totalTokens: number;
  durationMs: number;
  finalResult?: string;
  error?: string;
}

interface TraceIteration {
  number: number;
  llmInput: Message[];
  llmOutput: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokensUsed: number;
  durationMs: number;
}
```

Traces enable:
- Post-hoc debugging
- Comparison of runs
- Training data collection
- Regression detection

---

## Pattern 3: Benchmark Suites

### The Problem

Ad-hoc testing doesn't measure progress:
- No consistent baseline
- No way to compare versions
- No aggregate metrics

### The Solution

Define benchmark suites:

```typescript
interface BenchmarkSuite {
  name: string;
  description: string;
  tasks: BenchmarkTask[];
  metrics: MetricDefinition[];
}

interface BenchmarkTask {
  id: string;
  description: string;
  input: string;
  expectedBehaviors: string[];  // What should happen
  successCriteria: (result: AgentResult) => boolean;
  difficulty: 'easy' | 'medium' | 'hard';
}

const codeGenerationSuite: BenchmarkSuite = {
  name: 'code-generation',
  description: 'Tests for code generation tasks',
  tasks: [
    {
      id: 'fizzbuzz',
      description: 'Generate FizzBuzz implementation',
      input: 'Write a function that prints 1-100, Fizz for 3s, Buzz for 5s',
      expectedBehaviors: ['Uses modulo', 'Handles 15 case'],
      successCriteria: (r) => r.success && r.response.includes('function'),
      difficulty: 'easy',
    },
    // ... more tasks
  ],
  metrics: ['success_rate', 'avg_tokens', 'avg_time'],
};
```

---

## Pattern 4: Regression Detection

### The Problem

Changes that improve one thing often break another:
- New prompts affect old behaviors
- Tool changes cascade unexpectedly
- Model updates shift performance

### The Solution

Track metrics over time:

```typescript
interface MetricSnapshot {
  timestamp: number;
  version: string;
  suiteId: string;
  metrics: {
    successRate: number;
    avgTokens: number;
    avgTime: number;
    p95Time: number;
  };
  taskResults: Map<string, TaskMetrics>;
}

function detectRegression(
  current: MetricSnapshot,
  baseline: MetricSnapshot,
  threshold: number = 0.1
): RegressionReport {
  const regressions: string[] = [];

  // Check overall success rate
  const successDelta = baseline.metrics.successRate - current.metrics.successRate;
  if (successDelta > threshold) {
    regressions.push(
      `Success rate dropped ${(successDelta * 100).toFixed(1)}%`
    );
  }

  // Check per-task regressions
  for (const [taskId, currentTask] of current.taskResults) {
    const baselineTask = baseline.taskResults.get(taskId);
    if (!baselineTask) continue;

    if (currentTask.successRate < baselineTask.successRate - threshold) {
      regressions.push(
        `Task ${taskId}: success dropped from ${baselineTask.successRate} to ${currentTask.successRate}`
      );
    }
  }

  return {
    hasRegressions: regressions.length > 0,
    regressions,
    current,
    baseline,
  };
}
```

---

## Evaluation Metrics

### Primary Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| Success Rate | successes / total | >80% for production |
| Token Efficiency | tokens / successful_task | Lower is better |
| Time to Complete | avg(duration) | Task-dependent |
| Retry Rate | retries / total | <20% |

### Secondary Metrics

| Metric | Description |
|--------|-------------|
| Tool Call Accuracy | % of tool calls with valid arguments |
| Recovery Rate | % of recovered errors |
| Cost per Task | $ spent per successful task |
| Variance | Standard deviation of success rate |

### Confidence Intervals

For sample size n with success rate p:
```
Standard Error: SE = sqrt(p * (1-p) / n)
95% CI: p ± 1.96 * SE
```

For n=100 and p=0.8:
```
SE = sqrt(0.8 * 0.2 / 100) = 0.04
95% CI: [0.72, 0.88]
```

**Interpretation**: True success rate is 72-88% with 95% confidence.

---

## Trade-offs

### Run Count vs Time

| Runs | Confidence | Time | Use Case |
|------|------------|------|----------|
| 10 | Low | Fast | Quick sanity check |
| 50 | Medium | Moderate | Development testing |
| 100 | High | Slow | Release validation |
| 500+ | Very High | Very Slow | Research/benchmarks |

### Trace Detail Level

| Level | Data | Storage | Use Case |
|-------|------|---------|----------|
| Minimal | Result only | ~1KB | Production monitoring |
| Standard | + Tool calls | ~10KB | Debugging |
| Full | + LLM I/O | ~100KB+ | Research |
| Debug | + Token counts | ~200KB+ | Optimization |

---

## Files in This Section

- `evaluator.ts`: Statistical evaluation framework
- `trace.ts`: Trace capture and analysis
- `examples/eval-harness.ts`: Complete evaluation harness

---

## Further Reading

- **Fisher (1925)**: Statistical Methods for Research Workers
- **Deming (1986)**: Out of the Crisis (statistical process control)
- **Dietterich (1998)**: Approximate Statistical Tests for Comparing Supervised Classification Learning Algorithms
- **Report 26**: The Simple Architecture (production evaluation philosophy)
- **Cohen (1988)**: Statistical Power Analysis for the Behavioral Sciences

