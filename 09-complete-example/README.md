# Complete Production Agent

**Everything we've learned, integrated into one working system.**

---

## Architecture Overview

This example brings together all the principles from the guide:

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Runner                               │
│                        (run.ts)                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Configuration                               │
│                      (config.ts)                                 │
│  - Budget limits                                                 │
│  - Safety policies                                               │
│  - Ops parameters                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Production Ops Layer                          │
│                  (07-ops/production-agent.ts)                    │
│  - Retry with backoff                                            │
│  - Circuit breaker                                               │
│  - Rate limiting                                                 │
│  - Health checks                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Security Layer                               │
│                   (05-security/*)                                │
│  - Trifecta assessment                                           │
│  - Input sanitization                                            │
│  - Sandbox execution                                             │
│  - Audit logging                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Core                                  │
│                     (agent.ts)                                   │
│  - The Loop (01-the-loop)                                        │
│  - Tool execution (02-tool-design)                               │
│  - Action validation (03-validation)                             │
│  - State management (04-state-memory)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Tools                                      │
│                    (tools/*)                                     │
│  - File operations                                               │
│  - Search operations                                             │
│  - Done tool (explicit termination)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Principles in Action

### 1. The Loop (Wiener, 1948)

```typescript
// From agent.ts
while (this.canContinue()) {
  const response = await this.ops.callLlm(() => this.queryLLM());
  const validated = await this.validateResponse(response);
  const results = await this.executeTools(validated.toolCalls);
  this.updateState(results);
}
```

The agent IS its loop. Everything else is configuration.

### 2. Deterministic Guards (Report 26)

```typescript
// The LLM is inside a controlled environment
const response = await this.ops.callLlm(async () => {
  // Rate limited, retried, circuit-broken
  return this.client.chat({ messages, tools });
});

// Every action is validated before execution
const validated = await this.safety.validateAction(action);
if (!validated.allowed) {
  return { blocked: true, reason: validated.reason };
}
```

### 3. Complete Action Space (Ashby, 1956)

```typescript
// Tools define what the agent CAN do
const tools = [
  readFileTool,    // Read files
  writeFileTool,   // Write files
  searchTool,      // Search content
  doneTool,        // Explicit termination
];

// Start with full capabilities, restrict via validation
```

### 4. Explicit Termination (Report 27)

```typescript
// The Done tool is the ONLY way to complete
const doneTool = {
  name: 'done',
  description: 'Call when task is complete',
  execute: async ({ result }) => {
    this.completed = true;
    this.finalResult = result;
    return { status: 'completed' };
  },
};
```

### 5. Event-Sourced State (Report 26)

```typescript
// Every action is recorded
this.eventStore.append({
  type: 'tool_call',
  tool: toolCall.name,
  input: toolCall.input,
  timestamp: Date.now(),
});

// State is derived, never mutated directly
const currentState = projectState(this.eventStore.getEvents());
```

### 6. Security Trifecta (Willison)

```typescript
// Assess every interaction
const risk = this.trifecta.assessRisk({
  hasPrivateData: this.hasAccessToSecrets(),
  hasUntrustedInput: this.inputIsExternal(),
  hasExternalActions: this.canCallAPIs(),
});

if (risk.level === 'critical') {
  throw new SecurityError('Lethal trifecta detected');
}
```

### 7. Production Ops (Netflix, SRE)

```typescript
// Layered resilience
const ops = createProductionOps({
  retry: { enabled: true, maxAttempts: 3 },
  circuitBreaker: { enabled: true, failureThreshold: 5 },
  rateLimiter: { enabled: true, maxTokens: 60 },
  healthCheck: { enabled: true, intervalMs: 30000 },
});
```

---

## Files

| File | Purpose | Principles |
|------|---------|------------|
| `config.ts` | Configuration management | Budget limits, safety policies |
| `agent.ts` | Core agent implementation | The Loop, tool execution, state |
| `tools/index.ts` | Tool exports | Complete action space |
| `tools/file-tools.ts` | File operations | Sandboxed execution |
| `tools/search-tools.ts` | Search operations | Ephemeral results |
| `run.ts` | CLI entry point | Ops integration |

---

## Running the Example

```bash
# Install dependencies
npm install

# Run with a task
npx ts-node run.ts "Create a simple hello world program"

# Run with verbose output
npx ts-node run.ts --verbose "Analyze this codebase"

# Run in dry-run mode (no actual file changes)
npx ts-node run.ts --dry-run "Refactor the utils folder"
```

---

## Configuration

```typescript
// config.ts
export const config = {
  // Budget limits
  budget: {
    maxTokens: 100000,
    maxIterations: 50,
    maxTime: 300000, // 5 minutes
  },

  // Safety policies
  safety: {
    allowedPaths: ['/workspace'],
    blockedPatterns: ['rm -rf', 'sudo'],
    requireConfirmation: ['write_file', 'execute'],
  },

  // Ops configuration
  ops: {
    retryAttempts: 3,
    circuitBreakerThreshold: 5,
    rateLimitPerMinute: 60,
  },
};
```

---

## Extension Points

### Adding New Tools

```typescript
// tools/my-tool.ts
import { Tool, createTool } from '../../02-tool-design/tool-types';

export const myTool = createTool({
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: { ... },
  execute: async (input) => {
    // Implementation
    return { result: '...' };
  },
});

// Add to tools/index.ts
export { myTool } from './my-tool';
```

### Custom Validation

```typescript
// Add to config.ts
export const customValidator = createValidator(
  'custom',
  async (action) => {
    // Your validation logic
    if (someCondition(action)) {
      return { valid: false, reason: 'Not allowed' };
    }
    return { valid: true };
  }
);
```

### Custom Aggregation

```typescript
// For multi-agent scenarios
const customAggregator = async (results: WorkerResult[]) => {
  // Your aggregation logic
  return combinedResult;
};
```

---

## What This Example Demonstrates

1. **Integration**: All components work together seamlessly
2. **Layering**: Each layer has a specific responsibility
3. **Configurability**: Behavior is controlled through configuration
4. **Extensibility**: Easy to add new tools and validators
5. **Production-readiness**: Ops, security, and observability built-in

This is not a toy example. This is how production agents are built.

