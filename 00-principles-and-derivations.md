# Principles and Derivations

This document maps each principle in the guide to its source derivation—why the principle exists and how we discovered it.

---

## The Core Architecture

### Principle 1: The Loop Is Everything

**Statement**: An agent is a while loop that queries an LLM, validates outputs, executes tools, and observes results.

**Derivation Sources**:
- **Wiener (1948)**: Feedback loops are the foundation of self-correcting systems
- **Report 26 (The Simple Architecture)**: Every production system converges to this pattern
- **Report 28 (Bitter Lesson)**: "An agent is just a for-loop of tool calls"
- **Huntley (Loom)**: The "Ralph Wiggum Loop" - `while :; do cat PROMPT.md | claude-code ; done`
- **Willison**: "An agent runs tools in a loop to achieve a goal"

**The Code**:
```typescript
while (!done) {
  const action = await llm.generate(context);
  if (isValid(action)) {
    const result = await execute(action);
    observe(result);
  }
}
```

**Why This Works**: The architecture was discovered in 1948 (Wiener's cybernetics). LLMs filled in the one line that couldn't be implemented before—the `generate` function. Everything else is control structure.

---

### Principle 2: Deterministic Guards Around Stochastic Core

**Statement**: Your code owns the loop. The LLM is a stochastic generator you query, not a controller you delegate to.

**Derivation Sources**:
- **Report 22 (The Invention Is Over)**: "The LLM is part of the environment, not the controller"
- **Report 26**: LLMs achieve 60-70% reliability. Business needs 99.99%. Deterministic validation bridges the gap.
- **Production failures**: Putting control flow in prompts leads to non-deterministic behavior

**The Mental Model**:
```
Controller (your code):     Deterministic. Testable. Owns the loop.
Environment (includes LLM): Stochastic. Observable. Queried for generations.
```

**Why This Works**: You cannot unit test stochastic behavior. By keeping all validation and control flow deterministic, you create testable, predictable systems around an inherently unpredictable generator.

---

### Principle 3: One Context, One Goal

**Statement**: Each context window should have exactly one active task, one goal, one focus.

**Derivation Sources**:
- **Report 11 (Claude Code Architecture)**: Single-threaded master agent loop with flat message history
- **Report 25 (Huntley/Yegge)**: "One context window → One activity → One goal"
- **JetBrains Research**: Context rot—model performance degrades as context fills
- **Production experience**: Effective context is smaller than advertised (often <256K tokens)

**Implementation**:
- Pin specifications to context
- Give ONE task at a time
- Fresh context each iteration
- Memory persists through filesystem, not in-context accumulation

**Why This Works**: Attention mechanisms degrade with context length. Fresh, focused context produces better results than accumulated history.

---

## Tool and Action Design

### Principle 4: Complete Action Spaces

**Statement**: Start with maximal capability, then restrict based on evals. Don't anticipate every use case—the model already knows.

**Derivation Sources**:
- **Report 28 (Bitter Lesson)**: "Agent frameworks fail not because models are weak, but because their action spaces are incomplete"
- **Ashby's Law (1956)**: "Only variety can absorb variety"—controller must match environment complexity
- **gregpr07 (Browser-Use)**: Models were trained on computer use, coding, browsing. They don't need guardrails.

**The Inversion**:
```
Traditional: Start restricted → Add capabilities → Hope it's enough
Inverted:    Start with everything → Restrict based on evals → Scale with models
```

**Why This Works**: As models improve, restrictive action spaces become MORE harmful, not less. The model has variety (trained on everything). Your restricted tools don't.

---

### Principle 5: Explicit Termination (Done Tool)

**Statement**: Use an explicit "done" tool for task completion. Don't rely on implicit "no tool calls."

**Derivation Sources**:
- **Report 28**: Naive approach—stop when no tool calls—causes premature termination
- **Report 11 (Claude Code)**: Implements explicit termination pattern
- **Production experience**: Agents prematurely finish, especially when missing context

**Implementation**:
```typescript
@tool('Signal that the current task is complete.')
async function done(message: string): Promise<never> {
  throw new TaskComplete(message);
}
```

**Why This Works**: Explicit termination forces the model to consciously decide "I'm done" rather than implicitly stopping because it can't think of what to do next.

---

### Principle 6: Ephemeral Messages (Context Hygiene)

**Statement**: Tool results that produce large outputs should be ephemeral—keep only the last N instances.

**Derivation Sources**:
- **Report 28**: 50KB per browser snapshot × 20 interactions = 1MB of stale context
- **Report 25 (Huntley)**: Memory persists through filesystem, not in-context
- **Context rot research**: Old state causes hallucination of non-existent elements

**Implementation**:
```typescript
@tool("Get current state", { ephemeral: 3 })  // Keep last 3 only
async function getState(): Promise<string> {
  return massiveDomAndScreenshot;  // 50KB+
}
```

**Why This Works**: Old browser snapshots, file contents, and API responses are noise, not signal. Recency matters more than completeness.

---

## Security Model

### Principle 7: Break the Lethal Trifecta

**Statement**: Private Data + Untrusted Input + External Actions = Vulnerability. Break the trifecta somewhere.

**Derivation Sources**:
- **Report 22 (Willison)**: The crisp, actionable security model
- **Schneier (OODA analysis)**: Each OODA stage has attack surfaces
- **Report 4 (Security Threat Model)**: Comprehensive threat analysis

**Decision Matrix**:
| Has Private Data | Has Untrusted Input | Has External Actions | Action |
|------------------|---------------------|----------------------|--------|
| ✓ | ✓ | ✗ | Safe: No external actions |
| ✓ | ✗ | ✓ | Safe: Curated inputs only |
| ✗ | ✓ | ✓ | Safe: No private data access |
| ✓ | ✓ | ✓ | **DANGER**: Must break one leg |

**Why This Works**: Any two are manageable. All three together create systemic risk. This gives you a simple heuristic for agent security design.

---

### Principle 8: Subsumption Safety Layers

**Statement**: Safety behaviors live in lower layers that can always override higher-layer goals.

**Derivation Sources**:
- **Brooks (1986)**: Subsumption architecture—lower layers subsume higher layers
- **Report 19**: Maps directly to agent safety architecture
- **Beer's VSM (1972)**: System 5 (values/alignment) always overrides lower systems

**Layer Architecture**:
```
Layer 4: Exploration    <- Can be suppressed by any below
Layer 3: Goal           <- Can be suppressed by 0-2
Layer 2: Efficiency     <- Can be suppressed by 0-1
Layer 1: Compliance     <- Can be suppressed by 0
Layer 0: Safety         <- Can ALWAYS override everything
```

**Why This Works**: By making safety architectural rather than prompt-based, you ensure it cannot be bypassed by clever prompt injection or goal drift.

---

## State and Memory

### Principle 9: Memory Lives in Filesystem

**Statement**: Long-term memory persists through filesystem (files, git, databases), not in-context accumulation.

**Derivation Sources**:
- **Report 25 (Huntley/Loom)**: Memory through git commits, markdown files
- **Report 18 (FP Patterns)**: Event sourcing for agent state
- **Report 11 (Claude Code)**: CLAUDE.md hierarchy for persistent instructions

**Implementation Pattern**:
```typescript
function remember(key: string, value: any): void {
  db.set(key, { value, time: Date.now() });
}

function recall(query: string): any[] {
  return db.search(query, { orderBy: 'time', limit: 5 });
}
```

**Why This Works**: Context windows have finite capacity. Filesystem has infinite capacity. Use each for what it's good at.

---

### Principle 10: Event-Sourced State

**Statement**: Agent state should be an append-only log of events, not mutable state.

**Derivation Sources**:
- **Report 18 (FP Patterns)**: Event sourcing aligns with functional programming—once recorded, set in stone
- **Report 17 (Durable Execution)**: Temporal pattern—replay history rather than restart
- **Report 27 (Landauer's Principle)**: Information erasure has thermodynamic cost

**Benefits**:
- **Audit trail**: Complete history of decisions
- **Time travel**: Reconstruct state at any point
- **Debugging**: Replay production failures locally
- **Recovery**: Resume from checkpoint, not restart

**Why This Works**: Immutability enables debugging, auditing, and recovery. Mutable state makes all three harder.

---

## Evaluation and Testing

### Principle 11: Statistical Evaluation

**Statement**: Test distributions, not assertions. Same input → different outputs is expected.

**Derivation Sources**:
- **Report 22 (The Invention Is Over)**: "You can't unit test agent behavior meaningfully"
- **Report 26**: Evaluation must be statistical because the core is stochastic

**The Shift**:
| Deterministic Thinking | Agent Thinking |
|------------------------|----------------|
| Does it work? | What's the success rate? |
| Pass/fail | Distribution of outcomes |
| Reproduce the bug | Characterize the failure mode |
| Fix the line | Shift the distribution |

**Implementation**:
```typescript
async function evaluate(
  agent: Agent,
  cases: TestCase[],
  n: number = 100
): Promise<void> {
  for (const case of cases) {
    const scores = await Promise.all(
      Array(n).fill(null).map(() => score(agent.run(case)))
    );
    expect(mean(scores)).toBeGreaterThan(threshold);
    expect(std(scores)).toBeLessThan(maxVariance);
  }
}
```

**Why This Works**: Stochastic systems require statistical thinking. Applying deterministic testing to stochastic systems produces false confidence.

---

## Orchestration Patterns

### Principle 12: Single-Level Delegation

**Statement**: Main agent spawns sub-agents; sub-agents cannot spawn sub-agents.

**Derivation Sources**:
- **Report 11 (Claude Code)**: "Sub-agents CANNOT spawn sub-agents"
- **Yegge (Gas Town)**: "You talk to the foreman, not the workers"
- **Production failures**: Recursive self-improvement led to $2000/day costs

**Why This Works**: Prevents infinite nesting, explosion of agents, and uncontrolled cost. The main agent coordinates; workers execute.

---

### Principle 13: Ops vs Agent Distinction

**Statement**: The agent is trivial (the loop). Ops infrastructure (retries, rate limits, recovery) is where the work lives.

**Derivation Sources**:
- **Report 28 (Bitter Lesson)**: "Don't build an agent framework. Build ops infrastructure around a for-loop."
- **Report 17 (Unix/Distributed Systems)**: Process supervision, durable execution, circuit breakers

**The Agent** (trivial):
```typescript
while (!done) {
  const response = await llm(messages, tools);
  await execute(response.toolCalls);
}
```

**The Ops** (where work lives):
- Retries with exponential backoff
- Rate limit handling
- Connection recovery
- Context compaction
- Token tracking
- Checkpoint/restore

**Why This Works**: Conflating agent logic with operational concerns creates complexity. Separating them enables simpler agents AND better ops.

---

## The Meta-Principles

### Principle 14: The Invention Is Over

**Statement**: The theoretical work was done by 1990. LLMs made it implementable. Your job is translation, not invention.

**Derivation Sources**:
- **Report 22**: "Stop trying to invent new frameworks. The frameworks exist."
- **Report 19**: Wiener, Ashby, Simon, Minsky, Brooks—all before 1990
- **Report 27**: Physics principles (minimum energy) are even older

**Translation Table**:
| Classical Theory | Modern Translation |
|-----------------|-------------------|
| Wiener's feedback loop | Agent observes results, adjusts |
| Ashby's requisite variety | Tool repertoire matches task complexity |
| Simon's satisficing | "Good enough" threshold, not optimization |
| Minsky's society of mind | Multi-agent cooperation |
| Brooks' subsumption | Safety layers that override goals |

**Why This Works**: The "new agent architectures" are mostly rediscovering what was known. Read the old papers—they're better.

---

### Principle 15: The Bitter Lesson Applied

**Statement**: General methods that leverage computation beat hand-crafted approaches. As models improve, frameworks become MORE harmful, not less.

**Derivation Sources**:
- **Sutton (2019)**: Original Bitter Lesson—"general methods that leverage computation are ultimately the most effective"
- **Report 28 (gregpr07)**: Same pattern for agent frameworks
- **Report 27**: Simpler architectures are attractor states—complexity gets selected against

**The Trajectory**:
| Model Quality | Framework Effect |
|--------------|------------------|
| Weak models | Frameworks compensate for limitations |
| Good models | Frameworks start constraining capabilities |
| Great models | Frameworks actively fight model intelligence |

**Why This Works**: Every abstraction encodes assumptions about current model limitations. Tomorrow's model doesn't have those limitations—but your framework still assumes them.

---

### Principle 16: The Less You Build, The More It Works

**Statement**: Simplicity is the attractor state. Complex architectures are unstable and get selected against.

**Derivation Sources**:
- **Report 27 (Physics-Inspired)**: Minimum energy principle—systems evolve toward simplest configuration
- **Report 28**: "Every abstraction is a liability. Every 'helper' is a failure point."
- **Kolmogorov complexity**: Simpler programs are objectively better by information-theoretic standards

**The Evidence**: Every complex agent framework follows the same arc:
1. Impressive demos
2. Production struggles
3. Endless edge cases
4. Abandoned or rewritten

The ones that survive get simpler over time, not more complex.

**Why This Works**: Physics. The universe optimizes for minimum energy. Software that fights this principle requires constant effort to maintain.

---

## Summary: The Architecture

After 28 reports, 80 years of theory, and synthesis across frontier practitioners:

```typescript
async function agent(
  task: string,
  tools: Tool[],
  llm: LLM
): Promise<Result> {
  const messages: Message[] = [{ role: 'user', content: task }];

  while (true) {
    const response = await llm.invoke(messages, tools);

    if (response.done) {
      return response.result;
    }

    for (const call of response.toolCalls) {
      const result = await execute(call);
      messages.push({ ...result, ephemeral: true });
    }
  }
}
```

That's it. That's the architecture.

Everything else—retries, rate limits, persistence, monitoring—is ops infrastructure around this loop.

**The invention is over. The implementation is underway.**
