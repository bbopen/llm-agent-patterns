# Production Agent Guide - Structure

A practical TypeScript guide derived from 28 research reports and 80 years of theory.

---

## Design Philosophy

This guide follows three principles:

1. **Show derivations**: Every recommendation traces back to its source—classical theory, production experience, or practitioner insight
2. **Provide working code**: Not pseudocode or conceptual sketches, but TypeScript you can run
3. **Build incrementally**: Start with the minimal loop, add complexity only when needed

---

## Directory Structure

```
guide/
├── 00-principles-and-derivations.md    # Complete principle mapping (done)
├── STRUCTURE.md                         # This file
│
├── 01-the-loop/                         # The core architecture
│   ├── README.md                        # Why the loop (Wiener, Ashby, production convergence)
│   ├── minimal-agent.ts                 # 50-line complete agent
│   ├── types.ts                         # Core type definitions
│   └── examples/
│       ├── hello-world.ts               # Simplest possible agent
│       └── with-tools.ts                # Agent with tool execution
│
├── 02-tool-design/                      # Tool patterns
│   ├── README.md                        # Why complete action spaces (Ashby, Bitter Lesson)
│   ├── tool-types.ts                    # Tool interface definitions
│   ├── done-tool.ts                     # Explicit termination pattern
│   ├── ephemeral-results.ts             # Context hygiene pattern
│   └── examples/
│       ├── basic-tools.ts               # File, search, execute tools
│       └── mcp-integration.ts           # MCP server tools
│
├── 03-validation/                       # Deterministic guards
│   ├── README.md                        # Why validation (stochastic core, 60-70% reliability)
│   ├── validator.ts                     # Action validation framework
│   ├── policy.ts                        # Policy definition and checking
│   └── examples/
│       └── safety-layers.ts             # Subsumption-style safety
│
├── 04-state-memory/                     # State management
│   ├── README.md                        # Why filesystem memory (context limits, event sourcing)
│   ├── event-store.ts                   # Immutable event log
│   ├── context-manager.ts               # Context window management
│   └── examples/
│       ├── simple-memory.ts             # Key-value + recency
│       └── persistent-state.ts          # Filesystem-backed state
│
├── 05-security/                         # Security model
│   ├── README.md                        # Why the trifecta (Willison, Schneier)
│   ├── trifecta.ts                      # Trifecta assessment helpers
│   ├── sandbox.ts                       # Execution isolation
│   └── examples/
│       └── secure-agent.ts              # Agent with security layers
│
├── 06-evaluation/                       # Testing and evaluation
│   ├── README.md                        # Why statistical (stochastic systems)
│   ├── evaluator.ts                     # Statistical evaluation framework
│   ├── trace.ts                         # Trace capture for replay
│   └── examples/
│       └── eval-harness.ts              # Complete evaluation harness
│
├── 07-ops/                              # Operational infrastructure
│   ├── README.md                        # Why ops matters (retries, recovery, observability)
│   ├── retry.ts                         # Exponential backoff with jitter
│   ├── circuit-breaker.ts               # Fault tolerance
│   ├── rate-limiter.ts                  # Rate limiting
│   └── examples/
│       └── production-agent.ts          # Agent with full ops stack
│
├── 08-orchestration/                    # Multi-agent patterns
│   ├── README.md                        # Why single-level (recursion dangers)
│   ├── coordinator.ts                   # Coordinator pattern
│   ├── sub-agent.ts                     # Sub-agent spawning
│   └── examples/
│       └── delegating-agent.ts          # Main agent with workers
│
└── 09-complete-example/                 # Full production agent
    ├── README.md                        # Architecture overview
    ├── index.ts                         # Entry point
    ├── agent.ts                         # Complete agent implementation
    ├── tools/                           # Tool implementations
    ├── config.ts                        # Configuration
    └── run.ts                           # Execution script
```

---

## Each Section Format

Every section follows this structure:

### README.md

1. **The Principle**: Clear statement of what to do
2. **The Derivation**: Where this came from (with citations to reports)
3. **The Why**: Why this works
4. **The Trade-offs**: When this might not apply
5. **Further Reading**: Links to relevant research reports

### Code Files

Each `.ts` file includes:

```typescript
/**
 * [Filename]
 *
 * Derivation:
 * - [Source 1]: [Insight]
 * - [Source 2]: [Insight]
 *
 * This implements [principle] because [reason].
 */
```

---

## Dependencies

The guide uses minimal dependencies:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

No agent frameworks. The loop is 50 lines of TypeScript.

---

## Implementation Order

1. **01-the-loop**: Establish the core architecture
2. **02-tool-design**: Add tool execution capability
3. **03-validation**: Add deterministic guards
4. **04-state-memory**: Add persistence
5. **05-security**: Add security model
6. **06-evaluation**: Add testing capability
7. **07-ops**: Add production infrastructure
8. **08-orchestration**: Add multi-agent support
9. **09-complete-example**: Tie everything together

Each section builds on previous sections. You can stop at any point and have a working system.

---

## What This Guide Is NOT

- **Not a framework**: No abstraction layers, just patterns
- **Not comprehensive**: Only covers what the research validated
- **Not vendor-specific**: Works with any LLM provider
- **Not opinionated about deployment**: Focus is on agent logic, not infrastructure

---

## The Goal

After reading this guide, you should:

1. Understand WHY production agents look the way they do
2. Have working TypeScript code you can adapt
3. Know which classical theory supports each pattern
4. Be able to make informed trade-offs for your specific use case

The invention is over. This guide helps you implement what was already discovered.
