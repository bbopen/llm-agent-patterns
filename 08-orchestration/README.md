# Orchestration

**Principle**: Single-level delegation only. Recursive agent spawning leads to unbounded resource consumption and untraceable execution paths.

---

## The Derivation

### From System Complexity

**Herbert Simon (1962)** observed:
> "Hierarchical systems evolve faster and are more robust than non-hierarchical ones, but only when hierarchy has clear boundaries."

Applied to agents:
- Flat structures don't scale
- Unbounded recursion doesn't terminate
- Single-level delegation is the sweet spot

### From Production Experience (Reports 26, 28)

**Report 26** documented:
> "Agents spawning agents spawning agents. Context explodes. Costs spiral. Nobody knows what's running."

**Report 28** established the principle:
> "Single-level delegation: main agent spawns workers, workers don't spawn workers. That's it."

The insight: Multi-level delegation is theoretically appealing but practically disastrous.

### From Resource Management

Recursive spawning creates:
- **Unbounded cost**: Each level multiplies token consumption
- **Unbounded time**: Parallel spawning hides latency until it doesn't
- **Unbounded complexity**: Debugging requires tracing every branch
- **Unbounded risk**: Errors compound across levels

Single-level avoids all of these.

---

## Pattern 1: Coordinator-Worker

### The Problem

Complex tasks exceed what a single agent can handle:
- Too many steps
- Different skill requirements
- Parallel execution opportunities

### The Solution

One coordinator delegates to specialized workers:

```typescript
interface Coordinator {
  analyze(task: string): Task[];
  delegate(task: Task): Worker;
  combine(results: WorkerResult[]): string;
}

interface Worker {
  type: 'researcher' | 'implementer' | 'reviewer';
  execute(task: Task): Promise<WorkerResult>;
}

async function coordinatedExecution(task: string): Promise<string> {
  // 1. Coordinator analyzes task
  const subtasks = coordinator.analyze(task);

  // 2. Delegate to workers (parallel where possible)
  const results = await Promise.all(
    subtasks.map(async (subtask) => {
      const worker = coordinator.delegate(subtask);
      return worker.execute(subtask);  // Worker does NOT spawn more workers
    })
  );

  // 3. Combine results
  return coordinator.combine(results);
}
```

Workers are **terminal**—they execute and return, never delegate further.

---

## Pattern 2: Specialized Workers

### The Problem

One agent can't be expert at everything:
- Research requires broad knowledge
- Implementation requires precise coding
- Review requires critical analysis

### The Solution

Different worker types for different tasks:

```typescript
const workerTypes = {
  researcher: {
    tools: [webSearch, readDocs, summarize],
    systemPrompt: 'You are a research specialist...',
  },
  implementer: {
    tools: [readFile, writeFile, executeCommand],
    systemPrompt: 'You are a coding specialist...',
  },
  reviewer: {
    tools: [readFile, analyzeCode],
    systemPrompt: 'You are a code review specialist...',
  },
};

function selectWorker(task: Task): Worker {
  if (task.type === 'research') return createWorker(workerTypes.researcher);
  if (task.type === 'implement') return createWorker(workerTypes.implementer);
  if (task.type === 'review') return createWorker(workerTypes.reviewer);
  throw new Error(`Unknown task type: ${task.type}`);
}
```

---

## Pattern 3: Result Aggregation

### The Problem

Worker results need to be combined:
- Multiple research findings → coherent summary
- Multiple code changes → consistent codebase
- Multiple reviews → prioritized feedback

### The Solution

Explicit aggregation strategies:

```typescript
type AggregationStrategy = 'merge' | 'vote' | 'sequence' | 'first-success';

async function aggregate(
  results: WorkerResult[],
  strategy: AggregationStrategy
): Promise<string> {
  switch (strategy) {
    case 'merge':
      // Combine all results into one output
      return results.map(r => r.output).join('\n\n');

    case 'vote':
      // Take the most common result
      const votes = countVotes(results);
      return getMostCommon(votes);

    case 'sequence':
      // Apply results in order
      let state = initialState;
      for (const result of results) {
        state = applyResult(state, result);
      }
      return state;

    case 'first-success':
      // Return first successful result
      const success = results.find(r => r.success);
      return success?.output || 'All workers failed';
  }
}
```

---

## Pattern 4: Resource Budgets

### The Problem

Without limits, orchestration consumes unbounded resources:
- Each worker uses tokens
- Failed workers still cost money
- Parallel workers multiply cost

### The Solution

Explicit budgets at every level:

```typescript
interface ResourceBudget {
  maxTokens: number;
  maxTime: number;
  maxWorkers: number;
  maxIterationsPerWorker: number;
}

class BudgetedOrchestrator {
  private budget: ResourceBudget;
  private consumed = { tokens: 0, time: 0, workers: 0 };

  async spawnWorker(task: Task): Promise<WorkerResult> {
    // Check budget before spawning
    if (this.consumed.workers >= this.budget.maxWorkers) {
      throw new BudgetExceededError('worker limit');
    }

    this.consumed.workers++;

    const workerBudget = {
      maxTokens: Math.floor(
        (this.budget.maxTokens - this.consumed.tokens) /
        (this.budget.maxWorkers - this.consumed.workers + 1)
      ),
      maxIterations: this.budget.maxIterationsPerWorker,
    };

    const result = await executeWorker(task, workerBudget);

    this.consumed.tokens += result.tokensUsed;
    this.consumed.time += result.durationMs;

    return result;
  }
}
```

---

## Anti-Pattern: Recursive Spawning

### The Problem

```typescript
// BAD: Worker can spawn more workers
async function worker(task: Task): Promise<Result> {
  if (task.isComplex) {
    const subtasks = decompose(task);
    const subworkers = await Promise.all(
      subtasks.map(t => spawnWorker(t))  // Workers spawning workers!
    );
    return combine(subworkers);
  }
  return execute(task);
}
```

This leads to:
- Unbounded depth
- Exponential resource consumption
- Untraceable execution
- Cascade failures

### The Solution

Workers are terminal:

```typescript
// GOOD: Workers don't spawn workers
async function worker(task: Task): Promise<Result> {
  // Workers execute directly, never delegate
  return execute(task);
}

// Only coordinator decomposes
async function coordinator(task: Task): Promise<Result> {
  if (task.isComplex) {
    const subtasks = decompose(task);
    const results = await Promise.all(
      subtasks.map(t => worker(t))  // Flat: coordinator -> workers
    );
    return combine(results);
  }
  return worker(task);
}
```

---

## Trade-offs

### Parallelism

| Strategy | Latency | Cost | Reliability | Use Case |
|----------|---------|------|-------------|----------|
| Sequential | High | Low | High | Dependent tasks |
| Parallel | Low | High | Medium | Independent tasks |
| Batched | Medium | Medium | High | Mixed workloads |

### Worker Specialization

| Level | Flexibility | Quality | Overhead | Use Case |
|-------|-------------|---------|----------|----------|
| Generic | High | Medium | Low | Simple tasks |
| Specialized | Medium | High | Medium | Domain tasks |
| Highly Specialized | Low | Very High | High | Expert tasks |

---

## Files in This Section

- `coordinator.ts`: Coordinator pattern implementation
- `sub-agent.ts`: Worker/sub-agent spawning
- `examples/delegating-agent.ts`: Complete orchestration example

---

## Further Reading

- **Report 26**: The Simple Architecture (single-level delegation)
- **Report 28**: The Bitter Lesson (recursive spawning dangers)
- **Simon (1962)**: The Architecture of Complexity
- **MapReduce**: Google's parallel processing model

