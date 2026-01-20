# The Loop

**Principle**: An agent is a while loop that queries an LLM, validates outputs, executes tools, and observes results. That's the entire architecture.

---

## The Derivation

### From Classical Theory (1948-1986)

**Norbert Wiener** established feedback loops in 1948:
> "Self-correcting systems use feedback loops where real-time information about output continuously adjusts behavior toward a goal."

This is the theoretical foundation. The loop pattern isn't a design choice—it's what control systems look like.

**Ross Ashby** (1956) added the constraint:
> "Only variety can absorb variety. A control system must be at least as complex as the environment it aims to regulate."

This explains why agents need tools—they expand the agent's "variety" to match task complexity.

### From Production Systems (2024-2026)

Every production agent system converged on the same architecture:

- **Claude Code**: Single-threaded master loop, flat message history
- **Loom** (Huntley): `while :; do cat PROMPT.md | claude-code ; done`
- **Gas Town** (Yegge): Beads + Mayor pattern, but same core loop
- **Browser-Use** (gregpr07): "An agent is just a for-loop of tool calls"

**Simon Willison** gave the definition:
> "An agent runs tools in a loop to achieve a goal."

### From Research Synthesis (Reports 22, 26, 28)

Report 26 distilled the architecture:
```python
while not done:
    action = llm.generate(context)  # Stochastic
    if valid(action):                # Deterministic guard
        result = execute(action)     # Deterministic
        persist(result)              # Filesystem
```

Report 28 confirmed via the Bitter Lesson:
> "You don't need an agent framework. You don't need anything else. It's just a for-loop of tool calls."

---

## Why This Works

The architecture converged because **it was already discovered**. Wiener drew this diagram in 1948. The "new agent architectures" are rediscovering what was known.

LLMs filled in the one line that couldn't be implemented before: the `generate` function. A flexible reasoner that can take state, understand goals, and produce reasonable actions in natural language.

Everything else—validation, execution, observation, persistence—is control structure. **The LLM is ONE LINE.** Everything else is your code.

---

## The Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR DETERMINISTIC CODE                   │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Observe  │───▶│ Validate │───▶│ Execute  │             │
│   └────▲─────┘    └────┬─────┘    └────┬─────┘             │
│        │               │               │                    │
│        │         ┌─────▼─────┐         │                    │
│        │         │   DENY    │         │                    │
│        │         └───────────┘         │                    │
│        │                               │                    │
│        └───────────────────────────────┘                    │
│                        │                                     │
│                  ┌─────▼─────┐                              │
│                  │  Persist  │──────▶ [Filesystem]          │
│                  └───────────┘                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                         BOUNDARY                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                  ┌───────────────┐                           │
│                  │      LLM      │  ◀── Stochastic           │
│                  │   Generator   │      Environment          │
│                  └───────────────┘                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Critical insight**: The LLM is part of the environment, not the controller. Your code is the controller. You're not "prompting an agent"—you're building a system that queries a stochastic generator.

---

## Trade-offs

**This pattern applies when**:
- You need autonomous task completion
- Tasks require multiple steps with tool use
- You want predictable, testable behavior

**Consider alternatives when**:
- Single-turn completion is sufficient (no loop needed)
- You need sub-second latency (LLM latency may be too high)
- Tasks are purely computational (don't need language understanding)

---

## Files in This Section

- `types.ts`: Core type definitions for agents, tools, and messages
- `minimal-agent.ts`: Complete agent in ~50 lines
- `examples/hello-world.ts`: Simplest possible agent
- `examples/with-tools.ts`: Agent with tool execution

---

## Further Reading

- **Report 19**: Classical Foundations (Wiener, Ashby, Simon)
- **Report 22**: The Invention Is Over
- **Report 26**: The Simple Architecture
- **Report 28**: The Bitter Lesson of Agent Frameworks
- **Wiener (1948)**: Cybernetics
- **Ashby (1956)**: Introduction to Cybernetics
