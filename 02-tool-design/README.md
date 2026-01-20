# Tool Design

**Principle**: Tools expand agent capability. Design for complete action spaces, explicit termination, and context hygiene.

---

## The Derivation

### From Classical Theory (1956)

**Ross Ashby's Law of Requisite Variety**:
> "Only variety can absorb variety. A control system must be at least as complex as the environment it aims to regulate."

Translation: An agent cannot handle more complexity than its tools allow. Incomplete tool sets cause failures attributed to "the model being dumb" when the real problem is restricted capability.

### From The Bitter Lesson (Report 28)

**gregpr07** (Browser-Use) discovered:
> "Agent frameworks fail not because models are weak, but because their action spaces are incomplete."

The traditional approach is backwards:
```
Traditional: Start restricted → Add capabilities → Hope it's enough
Inverted:    Start with everything → Restrict based on evals → Scale with models
```

Models were trained on computer use, coding, browsing. They don't need guardrails—they need capability.

### From Production Experience (Reports 10, 11, 28)

Three patterns emerged from production systems:

1. **Done Tool**: Explicit termination prevents premature exit
2. **Ephemeral Messages**: Context hygiene prevents stale state pollution
3. **Strict Schemas**: Validation prevents malformed tool calls

---

## Pattern 1: Complete Action Spaces

### The Problem

Developers restrict tools "for safety" and then debug "model failures":

| What People Think | What's Actually Happening |
|-------------------|--------------------------|
| "The model is dumb" | The action space is incomplete |
| "Need more guardrails" | Guardrails are the problem |
| "Add planning module" | Planning module fights the model's planning |

### The Solution

Start with maximal capability. The model knows more patterns than you can anticipate.

```typescript
// BAD: Restricted action space
const tools = [
  readFile,      // Can read but...
  // no writeFile - "too dangerous"
  // no executeCommand - "security risk"
];
// Result: Agent fails on basic tasks

// GOOD: Complete action space with policy validation
const tools = [
  readFile,
  writeFile,
  executeCommand,
  searchWeb,
  // ... everything the task might need
];
// Validation layer handles safety (see 03-validation)
```

---

## Pattern 2: Done Tool (Explicit Termination)

### The Problem

The naive termination condition—stop when no tool calls—causes premature exit:

```typescript
// BAD: Implicit termination
while (true) {
  const response = await llm.invoke(messages, tools);
  if (!hasToolCalls(response)) {
    break;  // Agent quits when confused, not when done
  }
  // ...
}
```

Agents stop when they can't think of what to do next, not when the task is complete.

### The Solution

Force explicit completion with a done tool:

```typescript
// GOOD: Explicit termination
const doneTool: Tool = {
  definition: {
    name: 'task_complete',
    description: 'Signal that the current task is complete. Call this ONLY when you have fully accomplished the user\'s request.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished',
        },
        result: {
          type: 'string',
          description: 'The final result or answer',
        },
      },
      required: ['summary'],
    },
  },
  execute: async (input) => {
    throw new TaskComplete(input as { summary: string; result?: string });
  },
};
```

Now termination is a conscious decision, not a default.

---

## Pattern 3: Ephemeral Messages (Context Hygiene)

### The Problem

Tool results accumulate and pollute context:

```
Turn 1: get_browser_state() → 50KB DOM snapshot
Turn 2: get_browser_state() → 50KB DOM snapshot
...
Turn 20: get_browser_state() → 50KB DOM snapshot

Total: 1MB of stale browser state
Result: Model hallucinates elements that no longer exist
```

### The Solution

Mark large, frequently-updated tool results as ephemeral:

```typescript
interface EphemeralConfig {
  /** Keep only the last N results of this tool */
  keepLast: number;
}

const getBrowserState: Tool = {
  definition: { /* ... */ },
  execute: async () => { /* ... */ },
  ephemeral: { keepLast: 3 },  // Only keep last 3 snapshots
};
```

Old browser snapshots, file contents, and API responses are noise. Recency matters more than completeness.

---

## Tool Definition Best Practices

### Naming (Report 10)

| Rule | Example | Rationale |
|------|---------|-----------|
| 1-128 characters | `search_documents` | Prevents token bloat |
| Alphanumeric + `_-.` | `api.v2.get_user` | Namespace support |
| Descriptive verbs | `create_file` not `file` | Clear intent |
| No spaces | ~~`get user data`~~ | Schema compatibility |

### Descriptions

| Bad | Good |
|-----|------|
| `Searches stuff` | `Search documents by keyword with optional filters for date, author, and category` |
| `Does math` | `Perform arithmetic: add, subtract, multiply, divide. Returns numeric result.` |

### Schemas

Always use strict schemas:

```typescript
inputSchema: {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search keywords (supports AND/OR operators)',
      minLength: 1,
    },
    limit: {
      type: 'number',
      description: 'Maximum results to return',
      minimum: 1,
      maximum: 100,
    },
  },
  required: ['query'],
  additionalProperties: false,  // CRITICAL: Reject unexpected fields
}
```

---

## Trade-offs

### Complete Action Spaces

**Use when**:
- Tasks are open-ended or exploratory
- You have a validation layer (see 03-validation)
- Model capability should scale with improvements

**Be cautious when**:
- Operating in untrusted environments
- No validation layer exists
- Compliance requires explicit capability lists

### Ephemeral Messages

**Use when**:
- Tool outputs are large (>1KB)
- State changes frequently
- Context window is constrained

**Avoid when**:
- Historical state matters for the task
- Audit trail requires complete history
- Tool outputs are small and stable

---

## Files in This Section

- `tool-types.ts`: Enhanced tool types with ephemeral config
- `done-tool.ts`: Explicit termination implementation
- `ephemeral-results.ts`: Context hygiene management
- `examples/basic-tools.ts`: File, search, and execute tools
- `examples/mcp-integration.ts`: MCP server tool integration

---

## Further Reading

- **Report 10**: Tool Design Patterns (MCP, schemas, naming)
- **Report 28**: The Bitter Lesson (complete action spaces)
- **Ashby (1956)**: Law of Requisite Variety
- **MCP Specification**: modelcontextprotocol.io
