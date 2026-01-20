# LLM Agentic Systems: A Pattern Reference

*A canonical catalog of patterns for building autonomous LLM agents, grounded in classical control theory and validated by production experience.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Pattern Catalog](#pattern-catalog)
   - [Core Architecture Patterns](#1-core-architecture-patterns)
   - [Context Patterns](#2-context-patterns)
   - [Tool Patterns](#3-tool-patterns)
   - [State Patterns](#4-state-patterns)
   - [Security Patterns](#5-security-patterns)
   - [Resilience Patterns](#6-resilience-patterns)
   - [Orchestration Patterns](#7-orchestration-patterns)
3. [Anti-Patterns](#anti-patterns)
4. [Pattern Composition](#pattern-composition)
5. [Appendices](#appendices)

---

## Introduction

### What is an LLM Agent?

An LLM agent is a system that uses a language model to decide actions in pursuit of a goal. Strip away the marketing and frameworks, and you find:

```typescript
while (!done) {
  const action = await llm.generate(context);
  const result = await execute(action);
  observe(result);
}
```

That's it. Everything else is configuration around this loop.

### The Core Insight

The architecture for autonomous agents was discovered in **1948** by Norbert Wiener in his cybernetics work. The feedback loop (observe, act, adjust) is how all self-correcting systems work.

For 75 years, we couldn't implement one line: `llm.generate(context)`. Language models filled that gap. The rest of the architecture was already known.

**The invention is over. The implementation is underway.**

### How to Use This Reference

This document catalogs **patterns**, not prescriptions. Each one:

- Solves a specific problem in agent systems
- Traces to theory explaining why it works
- Includes minimal code showing the structure
- Documents trade-offs so you can decide when to apply it

Use this reference to:
1. **Understand** why production agents look the way they do
2. **Select** appropriate patterns for your specific context
3. **Compose** patterns into complete systems
4. **Avoid** common anti-patterns that cause failures

### Reading a Pattern Entry

Each pattern follows a consistent format:

| Section | Purpose |
|---------|---------|
| **Intent** | One sentence: what problem this solves |
| **Derivation** | Theory source and key insight |
| **Structure** | Minimal code showing the pattern |
| **Participants** | Components and their roles |
| **When to Use** | Situations where this pattern applies |
| **When NOT to Use** | When simpler alternatives suffice |
| **Consequences** | Benefits and trade-offs |
| **Implementation Notes** | Practical guidance |
| **Related Patterns** | How it connects to others |

---

## Pattern Catalog

---

## 1. Core Architecture Patterns

These patterns form the foundation. Every agent system implements these.

---

### Pattern 1.1: The Loop

#### Intent

Structure an agent as a feedback loop that queries an LLM, executes actions, and observes results until a goal is achieved.

#### Derivation

| Source | Insight |
|--------|---------|
| **Wiener (1948)** | Feedback loops are the foundation of self-correcting systems |
| **Brooks (1986)** | Simple loops with sensing beat complex planning |
| **Production Evidence** | Every successful production agent converges to this pattern |

> "An agent is just a for-loop of tool calls." — Report 28

#### Structure

```typescript
async function agent(
  task: string,
  tools: Tool[],
  llm: LLM
): Promise<Result> {
  const messages: Message[] = [{ role: 'user', content: task }];

  while (true) {
    // 1. GENERATE: Query the stochastic generator
    const response = await llm.invoke(messages, tools);

    // 2. CHECK TERMINATION: Explicit done signal
    if (response.done) {
      return response.result;
    }

    // 3. EXECUTE: Run tool calls
    for (const call of response.toolCalls) {
      const result = await execute(call);
      messages.push({ role: 'tool', content: result });
    }
    // 4. Loop continues (observe → act → adjust)
  }
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Loop Controller** | Owns iteration, termination, error handling |
| **LLM** | Stochastic generator queried for next action |
| **Tools** | Deterministic executors that affect environment |
| **Messages** | Accumulating context (conversation history) |

#### When to Use

- **Always**. This is the core architecture. Every agent is a loop.
- The question is what you wrap around it, not whether to use it.

#### When NOT to Use

- Single-shot LLM queries (not agents, just API calls)
- Pipelines with fixed steps (workflows, not agents)

#### Consequences

**Benefits:**
- Simple to understand and debug
- Matches how humans solve problems (try → observe → adjust)
- Naturally handles partial progress and recovery
- Testable: you can inject mock LLMs and verify loop behavior

**Trade-offs:**
- Loop can run indefinitely without termination guards
- Token costs accumulate with iterations
- No inherent parallelism (sequential by default)

#### Implementation Notes

1. **Always set a maximum iteration limit**. Runaway loops are the #1 production failure.
2. **Track token usage** per iteration for cost control.
3. **Log every iteration** for debugging and replay.
4. **The LLM is ONE LINE**. Everything else is control structure around it.

#### Related Patterns

- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Wrap validation around the loop
- **[Explicit Termination](#pattern-32-explicit-termination)**: How to exit the loop cleanly
- **[Event-Sourced State](#pattern-42-event-sourced-state)**: Persist loop history for replay

---

### Pattern 1.2: Deterministic Guards

#### Intent

Wrap the stochastic LLM with deterministic validation and control flow so that your code owns the loop behavior, not the LLM.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 22** | "The LLM is part of the environment, not the controller" |
| **Report 26** | LLMs achieve 60-70% reliability. Business needs 99.99%. Code bridges the gap. |
| **Production Failures** | Control flow in prompts leads to non-deterministic, untestable behavior |

> "You cannot unit test stochastic behavior. Keep validation deterministic."

#### Structure

```typescript
while (!done) {
  const action = await llm.generate(context);

  // DETERMINISTIC GUARDS: Code you can test
  if (!isValidAction(action)) {
    context.push({ role: 'user', content: formatValidationError(action) });
    continue; // Let LLM try again
  }

  if (!isAllowed(action, policy)) {
    context.push({ role: 'user', content: 'Action not permitted by policy' });
    continue;
  }

  if (exceedsBudget(action, budget)) {
    return { error: 'Budget exceeded', partial: context };
  }

  // Only execute if all guards pass
  const result = await execute(action);
  observe(result);
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Validator** | Checks action structure and schema |
| **Policy Checker** | Enforces business rules and permissions |
| **Budget Guard** | Prevents resource exhaustion |
| **Error Formatter** | Converts failures to LLM-readable feedback |

#### When to Use

- When LLM outputs must conform to schemas (always)
- When certain actions require authorization
- When you need to enforce budgets (tokens, time, API calls)
- When actions have side effects that must be auditable

#### When NOT to Use

- Toy demos where correctness doesn't matter
- Pure text generation without tool use

#### Consequences

**Benefits:**
- **Testable**: Guards are pure functions. Unit test them.
- **Predictable**: Same invalid action always fails the same way
- **Auditable**: Every guard decision can be logged
- **Recoverable**: LLM can retry with feedback on what went wrong

**Trade-offs:**
- Additional code to maintain
- Must keep schemas in sync between guards and tools
- Risk of over-constraining (blocking valid actions)

#### Implementation Notes

1. **Use JSON Schema or Zod** for structural validation
2. **Layer guards**: schema → policy → budget → execute
3. **Provide actionable feedback** to the LLM when guards reject
4. **Never put policy in prompts**. Prompts can be ignored; code cannot.

```typescript
// Good: Deterministic guard
if (action.tool === 'delete_file' && !policy.allowDelete) {
  return reject('File deletion not permitted');
}

// Bad: Prompt-based "guard"
const prompt = "Never delete files unless the user explicitly asks...";
// LLM can and will ignore this
```

#### Related Patterns

- **[The Loop](#pattern-11-the-loop)**: Guards wrap the loop's execute step
- **[Subsumption Safety Layers](#pattern-52-subsumption-safety-layers)**: Hierarchical guard architecture
- **[Complete Action Spaces](#pattern-31-complete-action-spaces)**: Guards restrict, not tools

---

## 2. Context Patterns

Patterns for managing the LLM's context window effectively.

---

### Pattern 2.1: One Context, One Goal

#### Intent

Maintain exactly one active task per context window. Fresh, focused context produces better results than accumulated history.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 25 (Huntley)** | "One context window → One activity → One goal" |
| **JetBrains Research** | Context rot: model performance degrades as context fills |
| **Production Experience** | Effective context is smaller than advertised (often <256K usable) |

> "Fresh context each iteration. Memory persists through filesystem, not in-context accumulation."

#### Structure

```typescript
// Anti-pattern: Accumulated context
const sharedContext = []; // Grows forever, performance degrades
for (const task of tasks) {
  sharedContext.push({ role: 'user', content: task });
  const result = await agent(sharedContext); // Context keeps growing
  sharedContext.push({ role: 'assistant', content: result });
}

// Pattern: Fresh context per goal
for (const task of tasks) {
  const freshContext = [
    { role: 'system', content: loadSystemPrompt() },
    { role: 'user', content: task },
    // Include only relevant prior context, not everything
    ...selectRelevantHistory(task, memory),
  ];
  const result = await agent(freshContext);
  await memory.store(task, result); // Persist to filesystem, not context
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Context Builder** | Assembles fresh context for each goal |
| **Memory Store** | Persists results outside context window |
| **Relevance Selector** | Chooses what prior context matters |

#### When to Use

- Multi-task agents that handle sequential goals
- Long-running sessions that would accumulate noise
- When you observe performance degradation over time

#### When NOT to Use

- Single-turn interactions (no accumulation possible)
- Tasks that genuinely require full conversation history

#### Consequences

**Benefits:**
- Consistent performance regardless of session length
- Lower token costs per task
- Easier debugging (fresh slate each time)
- Prevents context confusion from unrelated prior tasks

**Trade-offs:**
- Requires explicit memory management
- May lose relevant context if selector is poor
- More infrastructure needed (memory store)

#### Implementation Notes

1. **Pin specifications to context** at start of each goal
2. **Use filesystem for memory**, not context accumulation
3. **Summarize prior context** rather than including raw history
4. **Track effective context size**, not advertised limits

#### Related Patterns

- **[Filesystem Memory](#pattern-41-filesystem-memory)**: Where "remembered" context lives
- **[Ephemeral Messages](#pattern-22-ephemeral-messages)**: Cleaning context during a single task
- **[Event-Sourced State](#pattern-42-event-sourced-state)**: Reconstructing context from events

---

### Pattern 2.2: Ephemeral Messages

#### Intent

Mark large tool outputs as ephemeral, keeping only the last N instances in context to prevent pollution from stale data.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 28** | 50KB per browser snapshot × 20 interactions = 1MB of stale context |
| **Report 25 (Huntley)** | Memory persists through filesystem, not in-context |
| **Production Failures** | Old browser state causes hallucination of non-existent elements |

> "Old browser snapshots, file contents, and API responses are noise, not signal."

#### Structure

```typescript
interface Tool {
  definition: ToolDefinition;
  execute: (input: unknown) => Promise<string>;
  ephemeral?: {
    keepLast: number; // Keep only last N results in context
  };
}

// Example: Browser tool that produces large outputs
const browserTool: Tool = {
  definition: { name: 'get_page', description: 'Get current page state' },
  execute: async () => massiveDomSnapshot, // 50KB+
  ephemeral: { keepLast: 3 }, // Only keep 3 most recent
};

// Context management during loop
function pruneEphemeralMessages(messages: Message[]): Message[] {
  const counts = new Map<string, number>();

  // Iterate backwards, keeping only last N per ephemeral tool
  return messages.reverse().filter(msg => {
    if (msg.toolName && tools.get(msg.toolName)?.ephemeral) {
      const config = tools.get(msg.toolName)!.ephemeral!;
      const count = (counts.get(msg.toolName) || 0) + 1;
      counts.set(msg.toolName, count);
      return count <= config.keepLast;
    }
    return true; // Keep non-ephemeral messages
  }).reverse();
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Ephemeral Config** | Per-tool setting for retention count |
| **Context Pruner** | Removes old ephemeral messages |
| **Tool Registry** | Tracks which tools are ephemeral |

#### When to Use

- Browser automation (DOM snapshots are large and stale quickly)
- File reading (file contents change, old versions mislead)
- API responses (data freshness matters)
- Any tool producing >10KB outputs

#### When NOT to Use

- Small tool outputs (no benefit from pruning)
- Tools where history matters (e.g., "what was the file before edit?")

#### Consequences

**Benefits:**
- Prevents context window exhaustion
- Reduces hallucination from stale state
- Lower token costs per iteration
- Improves model focus on current state

**Trade-offs:**
- Loses history (can't reference earlier snapshots)
- Requires tracking which messages are from which tool
- More complex context management

#### Implementation Notes

1. **Default to ephemeral for browser/file tools**
2. **Log pruned messages** for debugging (don't discard silently)
3. **Use keepLast: 1** for tools where only current state matters
4. **Combine with filesystem memory** to persist if history needed

#### Related Patterns

- **[One Context, One Goal](#pattern-21-one-context-one-goal)**: Ephemeral supports focused context
- **[Filesystem Memory](#pattern-41-filesystem-memory)**: Persist pruned data if needed
- **[The Loop](#pattern-11-the-loop)**: Pruning happens between iterations

---

## 3. Tool Patterns

Patterns for designing and managing agent tools.

---

### Pattern 3.1: Complete Action Spaces

#### Intent

Give the LLM maximal capability, then restrict based on evaluation results. Don't try to anticipate every use case. The model already knows.

#### Derivation

| Source | Insight |
|--------|---------|
| **Ashby's Law (1956)** | "Only variety can absorb variety": the controller must match environment complexity |
| **Report 28 (Bitter Lesson)** | Frameworks fail because action spaces are incomplete |
| **gregpr07 (Browser-Use)** | Models were trained on computer use. They don't need guardrails. |

> "As models improve, restrictive action spaces become MORE harmful, not less."

#### Structure

```typescript
// Anti-pattern: Anticipate and restrict
const restrictedTools = [
  readFile,    // Only reading allowed
  // No writeFile - too dangerous!
  // No execute - definitely not!
];
// Agent fails on tasks requiring write/execute

// Pattern: Complete action space with guards
const completeTools = [
  readFile,
  writeFile,
  deleteFile,
  executeCommand,
  networkRequest,
  // Everything the model might need
];

// Restriction happens via validation, not tool omission
async function execute(action: Action): Promise<Result> {
  // Guard layer restricts based on policy, not tool availability
  if (!policy.allows(action)) {
    return { error: `Action '${action.tool}' not permitted` };
  }
  return tools.get(action.tool).execute(action.input);
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Tool Registry** | Complete set of available tools |
| **Policy Layer** | Restricts which tools are allowed per context |
| **Evaluation Results** | Inform which restrictions are needed |

#### When to Use

- Production agents handling diverse tasks
- When model capability is the limiting factor
- Building general-purpose agents (not narrow automation)

#### When NOT to Use

- Highly constrained environments (e.g., sandbox with no network)
- Compliance requirements mandating tool whitelists
- When you genuinely don't need certain capabilities

#### Consequences

**Benefits:**
- Agent can handle unforeseen use cases
- Scales with model improvements
- Reduces "agent can't do X" failures
- Matches model's training (full computer use)

**Trade-offs:**
- Larger tool descriptions in context
- More sophisticated policy layer needed
- Risk of unintended actions if guards are weak

#### Implementation Notes

1. **Start with everything**, restrict based on eval failures
2. **Use policy for restriction**, not tool omission
3. **Track which tools are actually used** to prune unused ones
4. **Models improve**. Restrictions that made sense in 2024 may not in 2025.

```typescript
// Evaluation-driven restriction
const toolUsage = await evaluateOnTestSuite(agent, completeTools);

// Only restrict tools that cause failures
const policy = {
  allowedTools: completeTools.filter(t =>
    !toolUsage.failuresCausedBy.includes(t.name)
  ),
};
```

#### Related Patterns

- **[Deterministic Guards](#pattern-12-deterministic-guards)**: How to restrict safely
- **[Subsumption Safety Layers](#pattern-52-subsumption-safety-layers)**: Hierarchical restrictions
- **[The Loop](#pattern-11-the-loop)**: Tools are executed within the loop

---

### Pattern 3.2: Explicit Termination

#### Intent

Use an explicit "done" tool for task completion instead of relying on the implicit signal of "no tool calls."

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 28** | Naive approach (stop when no tool calls) causes premature termination |
| **Report 11 (Claude Code)** | Implements explicit termination pattern |
| **Production Experience** | Agents prematurely finish when confused or missing context |

> "Explicit termination forces the model to consciously decide 'I'm done' rather than implicitly stopping because it can't think of what to do next."

#### Structure

```typescript
// The Done Tool
const doneTool: Tool = {
  definition: {
    name: 'done',
    description: 'Signal that the current task is complete. Call this when you have finished the task.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Summary of what was accomplished',
        },
      },
      required: ['message'],
    },
  },
  execute: async ({ message }) => {
    throw new TaskComplete(message); // Special exception for clean exit
  },
};

// Loop handling
async function agent(task: string, tools: Tool[]): Promise<Result> {
  const allTools = [...tools, doneTool]; // Always include done tool

  while (true) {
    try {
      const response = await llm.invoke(messages, allTools);

      for (const call of response.toolCalls) {
        const result = await execute(call); // May throw TaskComplete
        messages.push(toolResult(call.id, result));
      }

      // If no tool calls AND no done tool, prompt to continue or finish
      if (response.toolCalls.length === 0) {
        messages.push({
          role: 'user',
          content: 'Please continue with the task or call done() if complete.',
        });
      }
    } catch (e) {
      if (e instanceof TaskComplete) {
        return { success: true, message: e.message };
      }
      throw e;
    }
  }
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Done Tool** | Explicit termination signal |
| **TaskComplete Exception** | Clean exit mechanism |
| **Continuation Prompt** | Nudges model when it stops without done |

#### When to Use

- Any agent that should complete tasks (most agents)
- Multi-step tasks where premature exit is costly
- When you need completion confirmation

#### When NOT to Use

- Streaming/conversational agents that don't "complete"
- Single-turn queries

#### Consequences

**Benefits:**
- Clear completion semantics
- Model must explicitly decide to finish
- Captures completion summary
- Reduces premature termination

**Trade-offs:**
- One more tool in the registry
- Must handle TaskComplete exception
- Model might "forget" to call done (add continuation prompt)

#### Implementation Notes

1. **Make description clear**: "Call this when you have finished the task"
2. **Require a message**: Forces model to summarize what was done
3. **Handle no-tool-calls**: Prompt to continue or call done
4. **Log completion messages**: Useful for understanding agent behavior

#### Related Patterns

- **[The Loop](#pattern-11-the-loop)**: Done tool is how to exit the loop
- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Termination is a guard condition
- **[Complete Action Spaces](#pattern-31-complete-action-spaces)**: Done is always in the space

---

### Pattern 3.3: Tool Validation

#### Intent

Validate tool inputs against strict schemas before execution, catching malformed actions early and providing actionable feedback.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 10** | Tool schemas should use JSON Schema with additionalProperties: false |
| **Type Systems** | Catch errors at boundaries, not in business logic |
| **Production Failures** | LLMs generate plausible-but-wrong JSON |

#### Structure

```typescript
import { z } from 'zod';

interface Tool<TInput> {
  definition: ToolDefinition;
  inputValidator: z.ZodType<TInput>;  // Zod schema
  execute: (input: TInput) => Promise<string>;
}

// Define tool with strict validation
const writeFileTool: Tool<{ path: string; content: string }> = {
  definition: {
    name: 'write_file',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  inputValidator: z.object({
    path: z.string().min(1),
    content: z.string(),
  }).strict(),
  execute: async ({ path, content }) => {
    await fs.writeFile(path, content);
    return `Wrote ${content.length} bytes to ${path}`;
  },
};

// Validation wrapper
async function executeWithValidation(tool: Tool<any>, input: unknown): Promise<string> {
  const result = tool.inputValidator.safeParse(input);
  if (!result.success) {
    // Return validation error as tool result (not throw)
    return `Validation error: ${formatZodError(result.error)}`;
  }
  return tool.execute(result.data);
}
```

#### Participants

| Component | Role |
|-----------|------|
| **JSON Schema** | LLM-facing schema in tool definition |
| **Zod Validator** | Runtime validation in code |
| **Error Formatter** | Converts errors to LLM-readable feedback |

#### When to Use

- All tools with structured inputs (virtually all tools)
- When tool execution has side effects
- Production systems requiring reliability

#### When NOT to Use

- Toys/demos where validation overhead isn't worth it

#### Consequences

**Benefits:**
- Catches malformed inputs before execution
- Provides actionable feedback to LLM
- Documents expected input format
- Prevents crashes from invalid data

**Trade-offs:**
- Dual schema maintenance (JSON Schema + Zod)
- Validation overhead per tool call
- Must handle validation errors gracefully

#### Implementation Notes

1. **Use `additionalProperties: false`** in JSON Schema to reject extra fields
2. **Return errors as results**, don't throw. Let the LLM retry.
3. **Use `.strict()` in Zod** to match JSON Schema behavior
4. **Keep schemas in sync** between definition and validator

#### Related Patterns

- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Validation is a guard
- **[Complete Action Spaces](#pattern-31-complete-action-spaces)**: Valid input for all tools
- **[The Loop](#pattern-11-the-loop)**: Validation happens before execute

---

## 4. State Patterns

Patterns for managing agent state and memory.

---

### Pattern 4.1: Filesystem Memory

#### Intent

Persist long-term memory through the filesystem (files, git, databases) rather than accumulating in the context window.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 25 (Huntley/Loom)** | Memory through git commits, markdown files |
| **Report 11 (Claude Code)** | CLAUDE.md hierarchy for persistent instructions |
| **Resource Economics** | Context is expensive and limited; filesystem is cheap and infinite |

> "Context windows have finite capacity. Filesystem has infinite capacity. Use each for what it's good at."

#### Structure

```typescript
// Memory interface
interface Memory {
  store(key: string, value: unknown): Promise<void>;
  retrieve(key: string): Promise<unknown | null>;
  search(query: string, limit?: number): Promise<MemoryResult[]>;
}

// Filesystem-backed implementation
class FilesystemMemory implements Memory {
  constructor(private basePath: string) {}

  async store(key: string, value: unknown): Promise<void> {
    const path = join(this.basePath, `${key}.json`);
    await fs.writeFile(path, JSON.stringify({ value, timestamp: Date.now() }));
  }

  async retrieve(key: string): Promise<unknown | null> {
    try {
      const data = await fs.readFile(join(this.basePath, `${key}.json`), 'utf-8');
      return JSON.parse(data).value;
    } catch {
      return null;
    }
  }

  async search(query: string, limit = 5): Promise<MemoryResult[]> {
    // Simple recency-based search
    const files = await fs.readdir(this.basePath);
    const results = await Promise.all(
      files.map(async (f) => {
        const data = JSON.parse(await fs.readFile(join(this.basePath, f), 'utf-8'));
        return { key: f.replace('.json', ''), ...data };
      })
    );
    return results
      .filter(r => JSON.stringify(r.value).includes(query))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

// Memory tools for the agent
const memoryTools = [
  {
    name: 'remember',
    description: 'Store information for later',
    execute: async ({ key, value }) => {
      await memory.store(key, value);
      return `Stored "${key}"`;
    },
  },
  {
    name: 'recall',
    description: 'Retrieve stored information',
    execute: async ({ key }) => {
      const value = await memory.retrieve(key);
      return value ? JSON.stringify(value) : `No memory found for "${key}"`;
    },
  },
];
```

#### Participants

| Component | Role |
|-----------|------|
| **Memory Store** | Persists key-value data |
| **Remember Tool** | Agent interface for storing |
| **Recall Tool** | Agent interface for retrieval |
| **Search Index** | Enables semantic/keyword lookup |

#### When to Use

- Sessions longer than context window allows
- Multi-session agents that need persistent state
- When information must survive restarts

#### When NOT to Use

- Single-turn interactions
- When all needed context fits comfortably in window

#### Consequences

**Benefits:**
- Unlimited storage capacity
- Persists across sessions and restarts
- Searchable and auditable
- Decouples memory from context limits

**Trade-offs:**
- I/O latency for reads/writes
- Must decide what to remember vs. keep in context
- Search quality depends on implementation

#### Implementation Notes

1. **Use structured paths**: `memory/{session}/{category}/{key}.json`
2. **Include timestamps** for recency-based retrieval
3. **Git for versioning**: `git commit` after each store for history
4. **Index for search**: Consider SQLite or vector DB for large memories

#### Related Patterns

- **[One Context, One Goal](#pattern-21-one-context-one-goal)**: Memory enables fresh contexts
- **[Ephemeral Messages](#pattern-22-ephemeral-messages)**: Pruned messages can go to filesystem
- **[Event-Sourced State](#pattern-42-event-sourced-state)**: Events stored as files

---

### Pattern 4.2: Event-Sourced State

#### Intent

Store agent state as an append-only log of events, deriving current state by replaying the log. Enables debugging, replay, and recovery.

#### Derivation

| Source | Insight |
|--------|---------|
| **Event Sourcing** | "Store events, derive state" |
| **Report 18 (FP Patterns)** | Event sourcing aligns with functional programming: immutable history |
| **Report 17 (Durable Execution)** | Temporal pattern: replay history rather than restart |

> "Immutability enables debugging, auditing, and recovery. Mutable state makes all three harder."

#### Structure

```typescript
// Event types
type AgentEvent =
  | { type: 'task_started'; taskId: string; description: string; timestamp: number }
  | { type: 'tool_called'; toolName: string; input: unknown; timestamp: number }
  | { type: 'tool_result'; toolName: string; result: string; timestamp: number }
  | { type: 'decision'; content: string; timestamp: number }
  | { type: 'task_completed'; result: string; timestamp: number }
  | { type: 'error'; message: string; timestamp: number };

// Event store
class EventStore {
  private events: AgentEvent[] = [];

  append(event: Omit<AgentEvent, 'timestamp'>): void {
    this.events.push({ ...event, timestamp: Date.now() } as AgentEvent);
  }

  all(): AgentEvent[] {
    return [...this.events];
  }

  async persist(path: string): Promise<void> {
    await fs.appendFile(path, this.events.map(e => JSON.stringify(e)).join('\n'));
  }
}

// State derived from events
interface AgentState {
  iteration: number;
  toolCalls: number;
  errors: number;
  lastTool?: string;
}

function deriveState(events: AgentEvent[]): AgentState {
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'tool_called':
        return { ...state, toolCalls: state.toolCalls + 1, lastTool: event.toolName };
      case 'error':
        return { ...state, errors: state.errors + 1 };
      default:
        return state;
    }
  }, { iteration: 0, toolCalls: 0, errors: 0 });
}

// Replay capability
async function replayFromEvents(events: AgentEvent[]): Promise<void> {
  for (const event of events) {
    console.log(`[${event.timestamp}] ${event.type}:`, event);
  }
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Event** | Immutable record of something that happened |
| **Event Store** | Append-only log of events |
| **State Projector** | Derives current state from events |
| **Replayer** | Rebuilds execution from event history |

#### When to Use

- Debugging complex agent failures (replay to understand)
- Audit requirements (complete history)
- Recovery (resume from last checkpoint)
- Testing (replay production scenarios locally)

#### When NOT to Use

- Simple agents where state is trivial
- When disk space is severely constrained

#### Consequences

**Benefits:**
- Complete audit trail of all decisions
- Time-travel debugging (reconstruct any past state)
- Replay production failures locally
- Natural recovery points (resume from any event)

**Trade-offs:**
- Storage grows with every action
- State derivation cost (mitigated with snapshots)
- Must design events carefully

#### Implementation Notes

1. **Use JSONL format** (one event per line) for append-friendly storage
2. **Include session ID** in events for filtering
3. **Snapshot periodically** to avoid replaying entire history
4. **Immutability is key**. Never modify past events.

#### Related Patterns

- **[Filesystem Memory](#pattern-41-filesystem-memory)**: Events stored as files
- **[The Loop](#pattern-11-the-loop)**: Each iteration generates events
- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Guard decisions are events

---

## 5. Security Patterns

Patterns for securing agent systems.

---

### Pattern 5.1: Lethal Trifecta Assessment

#### Intent

Identify and break the "lethal trifecta" of Private Data + Untrusted Input + External Actions. When all three combine, the system is vulnerable.

#### Derivation

| Source | Insight |
|--------|---------|
| **Willison** | "Prompt injection is architectural, not just a bug" |
| **Schneier (OODA analysis)** | Each stage has attack surfaces |
| **Report 4** | Threat analysis for agent systems |

> "Any two are manageable. All three together create systemic risk."

#### Structure

```typescript
interface TrifectaAssessment {
  hasPrivateData: boolean;     // Database, secrets, user data
  hasUntrustedInput: boolean;  // User input, web content, emails
  hasExternalActions: boolean; // Code exec, network, file write
}

function assessRisk(assessment: TrifectaAssessment): 'low' | 'medium' | 'high' | 'critical' {
  const count = [
    assessment.hasPrivateData,
    assessment.hasUntrustedInput,
    assessment.hasExternalActions,
  ].filter(Boolean).length;

  if (count === 3) return 'critical';  // LETHAL TRIFECTA
  if (count === 2) return 'high';
  if (count === 1) return 'medium';
  return 'low';
}

// Decision matrix
// | Private | Untrusted | Actions | Risk     | Mitigation                    |
// |---------|-----------|---------|----------|-------------------------------|
// | Yes     | Yes       | No      | Medium   | Safe: no external actions     |
// | Yes     | No        | Yes     | Medium   | Safe: curated inputs only     |
// | No      | Yes       | Yes     | Medium   | Safe: no private data access  |
// | Yes     | Yes       | Yes     | CRITICAL | Must break one leg            |
```

#### Participants

| Component | Role |
|-----------|------|
| **Assessor** | Evaluates which legs are present |
| **Mitigator** | Recommends how to break trifecta |
| **Policy Enforcer** | Keeps one leg broken at all times |

#### When to Use

- Designing any agent that handles user input
- Security reviews of existing agents
- When adding new capabilities to agents

#### When NOT to Use

- Internal-only agents with no external input
- Read-only agents with no actions

#### Consequences

**Benefits:**
- Simple, memorable security heuristic
- Clear mitigation strategies
- Forces architectural security thinking
- Prevents "we'll add security later" mistakes

**Trade-offs:**
- May require limiting functionality
- Assessment requires understanding data flow
- "Breaking a leg" can be non-trivial

#### Implementation Notes

1. **Assess early** in design, not as afterthought
2. **Breaking options**:
   - Remove private data access (data isolation)
   - Sanitize/curate all inputs (input hardening)
   - Remove external action capability (sandbox)
3. **Prefer breaking untrusted input**. Sanitization is often easier than data isolation.
4. **Document which leg is broken** and why

```typescript
// Example: Email assistant
// Has: Private data (inbox), Untrusted input (emails), External actions (send)
// Mitigation: Read-only mode when processing untrusted emails

async function processEmail(email: UntrustedEmail): Promise<void> {
  const sanitized = sanitize(email);

  // While processing untrusted content, disable send capability
  const actions = email.isFromTrustedSender
    ? fullActions
    : readOnlyActions;  // Breaks the trifecta

  await agent.process(sanitized, actions);
}
```

#### Related Patterns

- **[Subsumption Safety Layers](#pattern-52-subsumption-safety-layers)**: Enforce trifecta breaking
- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Guards can break the trifecta
- **[Complete Action Spaces](#pattern-31-complete-action-spaces)**: Policy restricts, not tools

---

### Pattern 5.2: Subsumption Safety Layers

#### Intent

Put safety behaviors in lower layers that can always override higher-layer goals. This way, goal drift or prompt injection can't bypass safety.

#### Derivation

| Source | Insight |
|--------|---------|
| **Brooks (1986)** | Subsumption architecture: lower layers subsume higher |
| **Report 19** | Direct mapping to agent safety architecture |
| **Beer's VSM (1972)** | System 5 (values/alignment) always overrides lower systems |

> "By making safety architectural rather than prompt-based, it can't be bypassed."

#### Structure

```typescript
// Layer hierarchy (lower number = higher priority)
const LAYERS = {
  0: 'safety',      // Can ALWAYS override everything
  1: 'compliance',  // Legal/policy requirements
  2: 'efficiency',  // Resource constraints
  3: 'goal',        // Task completion
  4: 'exploration', // Nice-to-have behaviors
};

interface SafetyLayer {
  level: number;
  check: (action: Action) => { allowed: boolean; reason?: string };
}

// Layer 0: Safety (highest priority)
const safetyLayer: SafetyLayer = {
  level: 0,
  check: (action) => {
    if (action.tool === 'execute' && action.input.command.includes('rm -rf')) {
      return { allowed: false, reason: 'Destructive command blocked by safety layer' };
    }
    if (action.tool === 'network' && isKnownMaliciousDomain(action.input.url)) {
      return { allowed: false, reason: 'Malicious domain blocked' };
    }
    return { allowed: true };
  },
};

// Layer 1: Compliance
const complianceLayer: SafetyLayer = {
  level: 1,
  check: (action) => {
    if (action.tool === 'send_email' && !hasUserConsent()) {
      return { allowed: false, reason: 'Email requires user consent' };
    }
    return { allowed: true };
  },
};

// Subsumption: Lower layers always win
function checkAllLayers(action: Action, layers: SafetyLayer[]): { allowed: boolean; reason?: string } {
  // Sort by level (lowest first = highest priority)
  const sorted = [...layers].sort((a, b) => a.level - b.level);

  for (const layer of sorted) {
    const result = layer.check(action);
    if (!result.allowed) {
      return result; // Lower layer blocks, higher layers don't get a vote
    }
  }
  return { allowed: true };
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Layer 0 (Safety)** | Unconditional blocks (destructive ops, malware) |
| **Layer 1 (Compliance)** | Legal/policy requirements |
| **Layer 2 (Efficiency)** | Budget, rate limits |
| **Layer 3 (Goal)** | Task-specific restrictions |
| **Subsumption Controller** | Evaluates layers in priority order |

#### When to Use

- Any production agent with meaningful capabilities
- Multi-tenant systems with varying trust levels
- Agents that handle sensitive operations

#### When NOT to Use

- Sandboxed environments where safety is external
- Demos where safety overhead isn't needed

#### Consequences

**Benefits:**
- Safety cannot be prompt-injected away
- Clear hierarchy of concerns
- Easy to audit (check layer 0, then 1, etc.)
- Extensible (add layers as needed)

**Trade-offs:**
- Overhead of multiple checks per action
- Must carefully design layer boundaries
- Can be frustrating when safety blocks legitimate actions

#### Implementation Notes

1. **Layer 0 is non-negotiable**. Hardcode it, don't make it configurable.
2. **Keep layer 0 minimal**. Only truly dangerous operations.
3. **Log layer decisions** for debugging.
4. **Test layer interactions**. Make sure lower layers actually override.

#### Related Patterns

- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Layers are guards
- **[Lethal Trifecta Assessment](#pattern-51-lethal-trifecta-assessment)**: Safety layer breaks trifecta
- **[The Loop](#pattern-11-the-loop)**: Layers check before execute

---

## 6. Resilience Patterns

Patterns for handling failures in production.

---

### Pattern 6.1: Retry with Exponential Backoff

#### Intent

Handle transient failures by retrying with exponentially increasing delays and random jitter, preventing thundering herds and gracefully handling temporary issues.

#### Derivation

| Source | Insight |
|--------|---------|
| **Netflix** | "Design for failure. Assume everything will break." |
| **AWS** | "Exponential backoff with jitter prevents thundering herds" |
| **Report 26** | "Most 'agent failures' are infrastructure failures" |

> "Transient failures are normal. Retry with exponential backoff handles most automatically."

#### Structure

```typescript
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;    // ms
  maxDelay: number;     // ms
  jitterFactor: number; // 0-1
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = { maxAttempts: 3, baseDelay: 1000, maxDelay: 30000, jitterFactor: 0.5 }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === config.maxAttempts - 1) {
        throw error;
      }

      // Exponential backoff with jitter
      const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
      const jitter = 1 - config.jitterFactor + Math.random() * 2 * config.jitterFactor;
      const delay = Math.min(exponentialDelay * jitter, config.maxDelay);

      await sleep(delay);
    }
  }

  throw lastError!;
}

function isRetryable(error: unknown): boolean {
  const status = (error as any)?.status;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

  const message = String(error);
  if (/timeout|ECONNRESET|rate limit/i.test(message)) return true;

  return false;
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Retry Wrapper** | Executes function with retry logic |
| **Backoff Calculator** | Determines delay between retries |
| **Retryability Checker** | Decides if error is worth retrying |

#### When to Use

- All LLM API calls (rate limits, timeouts are common)
- Network operations
- Any operation that can fail transiently

#### When NOT to Use

- Operations that shouldn't be retried (e.g., money transfer)
- When fast failure is preferred (fail-fast scenarios)
- Non-idempotent operations without safeguards

#### Consequences

**Benefits:**
- Handles common transient failures automatically
- Prevents overwhelming services after recovery
- Jitter prevents synchronized retry storms
- Simple to add to any async operation

**Trade-offs:**
- Increases latency on failures
- May mask persistent issues
- Requires identifying retryable errors

#### Implementation Notes

1. **Always use jitter**. Without it, retries synchronize.
2. **Cap max delay**. Don't wait forever.
3. **Log retries**. Helps diagnose persistent issues.
4. **Consider idempotency**. Retrying non-idempotent ops is risky.

#### Related Patterns

- **[The Loop](#pattern-11-the-loop)**: Wrap LLM calls with retry
- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Retry on validation failures too

---

### Pattern 6.2: Circuit Breaker

#### Intent

Prevent cascading failures by temporarily blocking requests when a dependency is failing, allowing it time to recover.

#### Derivation

| Source | Insight |
|--------|---------|
| **Nygard (Release It!)** | Circuit breaker pattern for fault tolerance |
| **Netflix (Hystrix)** | Production-proven circuit breaker implementation |
| **Distributed Systems** | Fail fast when dependency is down |

#### Structure

```typescript
type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailure = 0;

  constructor(
    private threshold: number = 5,        // Failures before opening
    private resetTimeout: number = 30000, // ms to wait before half-open
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
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

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}

// Usage
const llmBreaker = new CircuitBreaker(5, 30000);

async function callLLM(messages: Message[]): Promise<Response> {
  return llmBreaker.execute(() => anthropic.messages.create({ messages }));
}
```

#### When to Use

- Calls to external services (LLM APIs, databases)
- When a failing dependency can bring down the whole system
- High-throughput systems where failures cascade

#### When NOT to Use

- Low-volume systems where retry is sufficient
- When the "circuit open" behavior is worse than waiting

---

## 7. Orchestration Patterns

Patterns for multi-agent coordination.

---

### Pattern 7.1: Single-Level Delegation

#### Intent

Main agent spawns sub-agents for complex tasks; sub-agents execute and return but never spawn their own sub-agents. This prevents infinite nesting and cost explosion.

#### Derivation

| Source | Insight |
|--------|---------|
| **Report 11 (Claude Code)** | "Sub-agents CANNOT spawn sub-agents" |
| **Yegge (Gas Town)** | "You talk to the foreman, not the workers" |
| **Production Failures** | Recursive self-improvement led to $2000/day costs |

> "The main agent coordinates; workers execute. No exceptions."

#### Structure

```typescript
// Main agent can delegate
class MainAgent {
  private subAgents: Map<string, SubAgent>;

  async execute(task: string): Promise<Result> {
    while (!done) {
      const response = await llm.invoke(messages, [...tools, delegateTool]);

      if (response.toolCalls.some(c => c.name === 'delegate')) {
        const delegateCall = response.toolCalls.find(c => c.name === 'delegate')!;
        const subResult = await this.delegate(delegateCall.input);
        messages.push(toolResult(delegateCall.id, subResult));
      }
      // ... handle other tool calls
    }
  }

  private async delegate(input: { type: string; task: string }): Promise<string> {
    const subAgent = this.subAgents.get(input.type);
    if (!subAgent) throw new Error(`Unknown sub-agent type: ${input.type}`);
    return subAgent.execute(input.task);
  }
}

// Sub-agents CANNOT delegate
class SubAgent {
  async execute(task: string): Promise<string> {
    // Note: No delegate tool available
    while (!done) {
      const response = await llm.invoke(messages, tools); // No delegation
      // ... execute and return
    }
    return result;
  }
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Main Agent** | Decomposes tasks, delegates, aggregates |
| **Sub-Agent** | Executes specific task type, returns result |
| **Delegate Tool** | Main agent's interface to spawn sub-agents |

#### When to Use

- Complex tasks that benefit from specialization
- When you need parallelism (main agent waits, sub-agents work)
- Clear task decomposition is possible

#### When NOT to Use

- Simple tasks that don't need delegation
- When sub-task boundaries aren't clear

#### Consequences

**Benefits:**
- Bounded execution (no infinite nesting)
- Predictable costs (count sub-agents, estimate tokens)
- Specialized sub-agents can be optimized per task
- Main agent maintains big-picture view

**Trade-offs:**
- Main agent must correctly decompose tasks
- Overhead of spawning sub-agents
- Sub-agents can't handle tasks needing further breakdown

#### Implementation Notes

1. **Strictly enforce no sub-agent delegation**. Don't give them the tool.
2. **Budget per sub-agent**. Limit iterations and tokens.
3. **Type sub-agents by capability** (research, implement, review)
4. **Main agent waits** for all sub-agents before continuing

#### Related Patterns

- **[The Loop](#pattern-11-the-loop)**: Each agent is a loop
- **[Deterministic Guards](#pattern-12-deterministic-guards)**: Guards prevent unauthorized delegation
- **[Lethal Trifecta Assessment](#pattern-51-lethal-trifecta-assessment)**: Sub-agents may have reduced privileges

---

### Pattern 7.2: Coordinator Pattern

#### Intent

A coordinator agent analyzes tasks, breaks them into subtasks, delegates to specialized workers, and aggregates results. Workers are terminal executors.

#### Derivation

| Source | Insight |
|--------|---------|
| **Simon (1962)** | "Hierarchical systems with clear boundaries" |
| **MapReduce** | Split, map (distribute), reduce (aggregate) |
| **Report 26** | Task decomposition enables parallelism |

#### Structure

```typescript
interface Coordinator {
  analyze(task: string): Promise<Subtask[]>;
  delegate(subtask: Subtask): Promise<WorkerResult>;
  aggregate(results: WorkerResult[]): Promise<string>;
}

class AgentCoordinator implements Coordinator {
  async execute(task: string): Promise<string> {
    // 1. ANALYZE: Break task into subtasks
    const subtasks = await this.analyze(task);

    // 2. DELEGATE: Execute subtasks (potentially in parallel)
    const results = await Promise.all(
      subtasks.map(st => this.delegate(st))
    );

    // 3. AGGREGATE: Combine results
    return this.aggregate(results);
  }

  async analyze(task: string): Promise<Subtask[]> {
    // Use LLM to decompose task
    const response = await llm.invoke([
      { role: 'system', content: 'Break this task into independent subtasks...' },
      { role: 'user', content: task },
    ]);
    return parseSubtasks(response);
  }

  async delegate(subtask: Subtask): Promise<WorkerResult> {
    const worker = this.selectWorker(subtask.type);
    return worker.execute(subtask.description);
  }

  async aggregate(results: WorkerResult[]): Promise<string> {
    // Merge, vote, or custom aggregation
    return results.filter(r => r.success).map(r => r.output).join('\n\n');
  }
}
```

#### Participants

| Component | Role |
|-----------|------|
| **Coordinator** | Analyzes, delegates, aggregates |
| **Analyzer** | Decomposes task into subtasks |
| **Workers** | Specialized executors |
| **Aggregator** | Combines worker results |

#### When to Use

- Large tasks that benefit from parallelism
- Tasks requiring different specializations
- When results from multiple sources should combine

#### When NOT to Use

- Sequential tasks with dependencies
- Simple tasks not worth decomposition overhead

#### Related Patterns

- **[Single-Level Delegation](#pattern-71-single-level-delegation)**: Coordinator uses single-level
- **[The Loop](#pattern-11-the-loop)**: Coordinator and workers are loops

---

## Anti-Patterns

Patterns to avoid. These cause production failures.

---

### Anti-Pattern 1: Framework Entanglement

**What It Looks Like:**
Building or using abstractions that encode assumptions about model limitations.

```typescript
// Anti-pattern: Framework that assumes models can't handle complex tools
class AgentFramework {
  // "Helper" that limits tool complexity
  addTool(tool: SimpleTool) { /* restricts to simple schemas */ }

  // "Guard" that assumes model will misuse tools
  validateOutput(output: string) { /* rigid output parsing */ }
}
```

**Why It Fails:**
- As models improve, the framework becomes the bottleneck
- Encodes 2023 model limitations into 2025 systems
- Abstractions fight model intelligence

**What to Do Instead:**
- Use minimal wrapper around LLM (The Loop pattern)
- Let model capabilities drive architecture
- Update restrictions based on evals, not assumptions

---

### Anti-Pattern 2: Recursive Delegation

**What It Looks Like:**
Allowing sub-agents to spawn their own sub-agents.

```typescript
// Anti-pattern: Sub-agent can delegate
class Agent {
  async execute(task: string) {
    // Sub-agent gets same tools including delegate
    const subAgent = new Agent(this.tools); // Oops
    await subAgent.execute(subtask);
  }
}
```

**Why It Fails:**
- Unbounded nesting → unbounded costs
- One production case: $2000/day from recursive spawning
- Main agent loses visibility into what's happening

**What to Do Instead:**
- Single-Level Delegation: main → workers, workers → results
- Workers get reduced tool set (no delegate)
- Budget limits per level

---

### Anti-Pattern 3: Context Accumulation

**What It Looks Like:**
Keeping all conversation history in context forever.

```typescript
// Anti-pattern: Context grows forever
const context = [];
while (!done) {
  context.push(userMessage);
  const response = await llm(context);
  context.push(response);
  // Context now includes everything, forever
}
```

**Why It Fails:**
- Context window fills with irrelevant history
- Performance degrades (context rot)
- Token costs scale with session length

**What to Do Instead:**
- Fresh context per goal (One Context, One Goal)
- Persist to filesystem, summarize into context
- Ephemeral messages for large tool outputs

---

### Anti-Pattern 4: Prompt-Based Control Flow

**What It Looks Like:**
Putting conditional logic, safety rules, or policies in prompts.

```typescript
// Anti-pattern: Control flow in prompt
const prompt = `
You are a helpful assistant.
IMPORTANT: Never delete files unless explicitly asked.
If the user seems upset, apologize and ask for clarification.
When processing emails, always check for phishing indicators.
`;
```

**Why It Fails:**
- Prompts can be ignored or overridden
- Not testable (can't unit test prompt compliance)
- Prompt injection can bypass "rules"

**What to Do Instead:**
- Deterministic Guards: policy checks in code
- Subsumption Safety Layers: architectural safety
- Use prompts for style/persona, not policy

---

### Anti-Pattern 5: Premature Optimization

**What It Looks Like:**
Building complex architectures before the simple loop works.

```typescript
// Anti-pattern: Start with complexity
const agent = new MultiModelCoordinatorWithCachingAndRAGAndMemoryAndMonitoring({
  primaryModel: 'gpt-4',
  fallbackModel: 'gpt-3.5',
  ragEndpoint: '...',
  vectorStore: '...',
  cache: redis,
  monitoring: datadog,
});
```

**Why It Fails:**
- Can't debug failures (too many layers)
- Complexity is a liability, not an asset
- "Every abstraction is a failure point"

**What to Do Instead:**
- Start with 50-line loop (minimal-agent.ts)
- Add complexity only when loop fails in measurable ways
- Each addition must justify its complexity cost

---

## Pattern Composition

How patterns combine into complete systems.

---

### Minimal Agent

**Pattern Stack:**
1. The Loop
2. Explicit Termination

**Use When:** Demos, prototypes, simple automation

```
┌─────────────────────────────────────┐
│              The Loop               │
│  ┌───────────┐      ┌───────────┐   │
│  │    LLM    │─────→│   Tools   │   │
│  └───────────┘      │  + Done   │   │
│       ↑             └───────────┘   │
│       └──────────────────┘          │
└─────────────────────────────────────┘
```

---

### Production Agent

**Pattern Stack:**
1. The Loop
2. Deterministic Guards
3. Tool Validation
4. Ephemeral Messages
5. Event-Sourced State
6. Retry with Backoff
7. Lethal Trifecta Assessment

**Use When:** Production systems, user-facing agents

```
┌─────────────────────────────────────────────────┐
│                  Production Agent               │
│  ┌─────────────────────────────────────────┐    │
│  │              Ops Layer                  │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  │    │
│  │  │  Retry  │  │ Circuit │  │  Rate   │  │    │
│  │  │ Backoff │  │ Breaker │  │ Limiter │  │    │
│  │  └─────────┘  └─────────┘  └─────────┘  │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │            Security Layer               │    │
│  │  ┌───────────────┐  ┌───────────────┐   │    │
│  │  │   Trifecta    │  │  Subsumption  │   │    │
│  │  │  Assessment   │  │    Layers     │   │    │
│  │  └───────────────┘  └───────────────┘   │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │              Core Loop                  │    │
│  │  ┌───────┐  ┌────────┐  ┌───────────┐   │    │
│  │  │  LLM  │→ │ Guards │→ │   Tools   │   │    │
│  │  └───────┘  └────────┘  └───────────┘   │    │
│  │       ↑                      │          │    │
│  │       └──────────────────────┘          │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │            State Layer                  │    │
│  │  ┌───────────────┐  ┌───────────────┐   │    │
│  │  │  Event Store  │  │   Filesystem  │   │    │
│  │  │   (History)   │  │    Memory     │   │    │
│  │  └───────────────┘  └───────────────┘   │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

### Multi-Agent System

**Pattern Stack:**
All Production Agent patterns, plus:
- Single-Level Delegation
- Coordinator Pattern

**Use When:** Complex tasks requiring specialization

```
┌────────────────────────────────────────────────────────┐
│                    Multi-Agent System                  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │               Main Agent (Coordinator)           │  │
│  │  ┌──────────────────────────────────────────┐    │  │
│  │  │    Analyze → Delegate → Aggregate        │    │  │
│  │  └──────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                             │
│          ┌───────────────┼───────────────┐             │
│          ↓               ↓               ↓             │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
│  │   Research    │ │  Implement    │ │    Review     │ │
│  │    Worker     │ │    Worker     │ │    Worker     │ │
│  │ (No delegate) │ │ (No delegate) │ │ (No delegate) │ │
│  └───────────────┘ └───────────────┘ └───────────────┘ │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Appendices

### Appendix A: Theory Sources

| Source | Year | Key Contribution |
|--------|------|------------------|
| **Wiener** | 1948 | Feedback loops, cybernetics |
| **Ashby** | 1956 | Requisite variety, homeostasis |
| **Simon** | 1962 | Hierarchical systems, satisficing |
| **Minsky** | 1986 | Society of mind, agent cooperation |
| **Brooks** | 1986 | Subsumption architecture, behavior-based |
| **Beer** | 1972 | Viable System Model, organizational cybernetics |
| **Sutton** | 2019 | The Bitter Lesson |

### Appendix B: Pattern Quick Reference

| Pattern | Intent | Key Insight |
|---------|--------|-------------|
| The Loop | Agent as feedback loop | while (!done) { generate → execute → observe } |
| Deterministic Guards | Wrap stochastic with deterministic | Code you can test around code you can't |
| One Context, One Goal | Fresh context per task | Memory in filesystem, not context |
| Ephemeral Messages | Prune old tool outputs | keepLast: N prevents context rot |
| Complete Action Spaces | Start maximal, restrict via evals | Ashby: controller must match variety |
| Explicit Termination | Done tool, not implicit stop | Model consciously decides "I'm done" |
| Tool Validation | Schema validation before execute | Catch malformed actions early |
| Filesystem Memory | Persist to disk, not context | Infinite storage, survives restarts |
| Event-Sourced State | Append-only log, derive state | Replay, debug, recover |
| Lethal Trifecta | Break Data+Input+Actions | Any two okay, all three dangerous |
| Subsumption Safety | Lower layers override higher | Safety is architectural, not prompt-based |
| Retry with Backoff | Exponential delay + jitter | Handles transient failures automatically |
| Single-Level Delegation | Main → workers, no nesting | Bounded execution, predictable costs |
| Coordinator | Analyze → delegate → aggregate | MapReduce for agents |

### Appendix C: Decision Flowchart

```
START: New Agent Project
           │
           ↓
┌─────────────────────────┐
│ Is it a single LLM call?│
└─────────────────────────┘
           │
     ┌─────┴─────┐
     │ Yes       │ No
     ↓           ↓
 Not an      Use The Loop
 Agent       Pattern
                 │
                 ↓
┌─────────────────────────────┐
│ Does it handle user input?  │
└─────────────────────────────┘
           │
     ┌─────┴─────┐
     │ Yes       │ No
     ↓           ↓
 Add Trifecta   Skip security
 Assessment     patterns
     │           │
     └─────┬─────┘
           ↓
┌─────────────────────────────┐
│ Is this production/serious? │
└─────────────────────────────┘
           │
     ┌─────┴─────┐
     │ Yes       │ No
     ↓           ↓
 Add Guards,    Minimal
 Retry, Events  Loop only
     │           │
     └─────┬─────┘
           ↓
┌─────────────────────────────┐
│ Tasks need specialization?  │
└─────────────────────────────┘
           │
     ┌─────┴─────┐
     │ Yes       │ No
     ↓           ↓
 Add Single-    Single agent
 Level Deleg.   sufficient
           │
           ↓
         DONE
```

---

## Conclusion

The architecture for autonomous agents was discovered in 1948. LLMs filled in the one line that couldn't exist before. Everything else (loops, guards, memory, safety, orchestration) was already known.

This catalog documents patterns that work. They work because they're grounded in theory (Wiener, Ashby, Brooks) and validated by production experience. They're not opinions. They're attractor states that systems converge to.

**Use these patterns. Avoid the anti-patterns. Ship agents that work.**

---

*The invention is over. The implementation is underway.*
