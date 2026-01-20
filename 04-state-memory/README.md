# State & Memory

**Principle**: Memory lives in the filesystem, not in context. Use event sourcing for state that needs replay. Manage context windows deliberately.

---

## The Derivation

### From Distributed Systems

Event sourcing emerged from decades of distributed systems experience:

> "Store the sequence of events, not just the current state. The current state can always be recomputed from events."

For agents:
- Actions are events
- State is derived from action history
- Replay enables debugging and recovery
- Audit trails come free

### From Production Experience (Reports 11, 25)

**Huntley (Report 25)** observed:
> "Memory persists through filesystem, not in-context. Claude Code stores context in files, not conversation history."

**Claude Code (Report 11)** implements:
> "Filesystem as memory store. Everything important gets written to files. Context can be reconstructed from files."

The insight: Context windows are expensive and ephemeral. Filesystem is cheap and persistent.

### From Context Limits

LLM context windows have hard limits:
- 128K-200K tokens typical
- Cost scales with context size
- Old context becomes noise

Without management:
```
Turn 1: Task context (5K) + Tool result (50K)
Turn 2: Task + Result 1 (55K) + Tool result (50K)
...
Turn 10: 500KB of mostly stale information
Result: Context overflow or model confusion
```

With management:
```
Turn 1: Task (5K) + Tool result (50K)
Turn 2: Task (5K) + Summary (1K) + Tool result (50K)
...
Turn 10: Task (5K) + Rolling summary (5K) + Recent (50K) = 60KB
```

---

## Pattern 1: Event Store

### The Problem

Agent state changes through actions:
- Files created/modified
- APIs called
- Decisions made

Without history:
- Can't debug failures
- Can't replay scenarios
- Can't understand how we got here

### The Solution

Log every action as an immutable event:

```typescript
interface AgentEvent {
  id: string;
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'decision' | 'error';
  data: Record<string, unknown>;
  metadata: {
    iteration: number;
    parentEventId?: string;
  };
}

class EventStore {
  private events: AgentEvent[] = [];

  append(event: Omit<AgentEvent, 'id' | 'timestamp'>): AgentEvent {
    const complete = {
      ...event,
      id: generateId(),
      timestamp: Date.now(),
    };
    this.events.push(complete);
    return complete;
  }

  replay(from?: number): AgentEvent[] {
    if (from === undefined) return [...this.events];
    return this.events.filter(e => e.timestamp >= from);
  }

  getState(): DerivedState {
    // Compute current state from event sequence
    return this.events.reduce(reduceEvent, initialState);
  }
}
```

---

## Pattern 2: Filesystem Memory

### The Problem

In-context memory is:
- Expensive (tokens cost money)
- Ephemeral (lost on context overflow)
- Limited (hard caps on size)

### The Solution

Write important information to files:

```typescript
interface FileMemory {
  // Store arbitrary key-value data
  set(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown | undefined>;
  delete(key: string): Promise<void>;

  // Store structured documents
  writeDocument(path: string, content: string): Promise<void>;
  readDocument(path: string): Promise<string>;

  // List what we know
  listKeys(): Promise<string[]>;
}

// Implementation writes to .agent/ directory
const memory = new FileMemory('.agent/memory');

// Store context that should survive conversation
await memory.set('project_structure', {
  rootDir: '/app',
  mainLanguage: 'typescript',
  buildSystem: 'npm',
});

// Store decisions for future reference
await memory.writeDocument('decisions/auth.md', `
# Authentication Decision

We chose JWT over sessions because:
1. Stateless - scales horizontally
2. Standard - broad library support
3. Flexible - works for API and web

Date: ${new Date().toISOString()}
`);
```

---

## Pattern 3: Context Window Management

### The Problem

Without management, context fills with stale information:
- Old tool results
- Superseded file contents
- Resolved error messages

### The Solution

Active context management:

```typescript
interface ContextWindow {
  maxTokens: number;
  currentTokens: number;
  messages: Message[];
}

class ContextManager {
  private window: ContextWindow;

  constructor(maxTokens: number) {
    this.window = { maxTokens, currentTokens: 0, messages: [] };
  }

  add(message: Message): void {
    const tokens = countTokens(message);

    // If adding would exceed limit, make room
    while (this.window.currentTokens + tokens > this.window.maxTokens) {
      this.compress();
    }

    this.window.messages.push(message);
    this.window.currentTokens += tokens;
  }

  private compress(): void {
    // Strategy: Summarize old messages, keep recent ones
    const old = this.window.messages.slice(0, -5);
    const recent = this.window.messages.slice(-5);

    if (old.length === 0) {
      throw new Error('Cannot compress: too few messages');
    }

    const summary = this.summarize(old);
    this.window.messages = [summary, ...recent];
    this.window.currentTokens = this.window.messages
      .reduce((sum, m) => sum + countTokens(m), 0);
  }

  private summarize(messages: Message[]): Message {
    // Create a summary message
    return {
      role: 'user',
      content: `[Summary of ${messages.length} previous messages: ...]`,
    };
  }
}
```

---

## Pattern 4: Checkpoint and Recovery

### The Problem

Long-running agents need resilience:
- Process crashes
- API timeouts
- User interrupts

Losing all progress is unacceptable.

### The Solution

Checkpoint state periodically:

```typescript
interface Checkpoint {
  id: string;
  timestamp: number;
  state: {
    iteration: number;
    messages: Message[];
    toolState: Record<string, unknown>;
    pendingActions: ToolCall[];
  };
}

class CheckpointManager {
  private store: FileStore;

  async save(state: Checkpoint['state']): Promise<string> {
    const checkpoint: Checkpoint = {
      id: generateId(),
      timestamp: Date.now(),
      state,
    };

    await this.store.write(
      `checkpoints/${checkpoint.id}.json`,
      JSON.stringify(checkpoint)
    );

    return checkpoint.id;
  }

  async restore(id: string): Promise<Checkpoint['state']> {
    const data = await this.store.read(`checkpoints/${id}.json`);
    const checkpoint = JSON.parse(data) as Checkpoint;
    return checkpoint.state;
  }

  async latest(): Promise<Checkpoint | undefined> {
    const files = await this.store.list('checkpoints/');
    if (files.length === 0) return undefined;

    // Get most recent by timestamp
    const sorted = files.sort().reverse();
    const data = await this.store.read(sorted[0]);
    return JSON.parse(data);
  }
}
```

---

## Trade-offs

### Event Sourcing

| Use When | Avoid When |
|----------|------------|
| Audit trail required | Simple stateless tasks |
| Debugging complex flows | Memory constrained |
| Replay/testing needed | Real-time requirements |
| State evolution matters | Write-heavy workloads |

### Filesystem Memory

| Use When | Avoid When |
|----------|------------|
| Cross-session persistence | Ephemeral environments |
| Large data (>1KB) | Frequent small updates |
| Structured documents | Real-time data |
| Cheap storage available | Serverless cold starts |

### Context Compression

| Use When | Avoid When |
|----------|------------|
| Long conversations | Short interactions |
| Context approaching limit | Historical context matters |
| Cost optimization needed | Debugging (keep full context) |
| Repeated similar queries | Unique complex queries |

---

## Files in This Section

- `event-store.ts`: Immutable event log implementation
- `context-manager.ts`: Context window management
- `examples/simple-memory.ts`: Key-value filesystem memory
- `examples/persistent-state.ts`: Full checkpoint/recovery system

---

## Further Reading

- **Report 25**: Loop Orchestration (filesystem memory pattern)
- **Report 11**: Claude Code (context management in practice)
- **Event Sourcing**: Martin Fowler's patterns
- **CQRS**: Command Query Responsibility Segregation

