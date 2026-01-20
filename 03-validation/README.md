# Validation

**Principle**: Wrap the stochastic core in deterministic guards. LLMs are 60-70% reliable per step; your validation layer provides the remaining 30-40%.

---

## The Derivation

### From Cybernetics (1948)

**Norbert Wiener** established a fundamental insight:
> "The controller (your code) and the environment (the system being controlled) form a feedback loop. The controller must be deterministic to provide stability."

In agent systems:
- The LLM is the "environment"—it produces outputs
- Your code is the "controller"—it decides what's acceptable
- The validation layer is your control mechanism

### From Probability Theory

At 70% per-step reliability across a 10-step task:
```
0.70^10 = 0.028 (2.8% success rate)
```

With validation that catches and corrects 50% of errors:
```
Effective per-step: ~85%
0.85^10 = 0.197 (19.7% success rate)
```

With validation that catches 80% of errors:
```
Effective per-step: ~94%
0.94^10 = 0.538 (53.8% success rate)
```

**Validation doesn't just catch errors—it enables multi-step tasks to succeed at all.**

### From Production Experience (Reports 26, 28)

**Weng (Report 26)** observed:
> "The stochastic part does 60-70% right. Perfect for single tasks. For multi-step operations, you need deterministic guardrails."

**gregpr07 (Report 28)** implemented:
> "Validation layer handles safety. Restricted action spaces cause more failures than they prevent."

The insight: Don't restrict capabilities—validate actions.

### From Robotics (Brooks, 1986)

**Rodney Brooks'** subsumption architecture:
> "Lower-level behaviors can always override higher-level goals. Safety is not negotiable."

Applied to agents:
- Layer 0: Physical/system safety (always runs)
- Layer 1: Policy compliance (permissions)
- Layer 2: Resource limits (cost, time)
- Layer 3: Goal pursuit (the actual task)

Lower layers subsume higher layers. Safety always wins.

---

## Pattern 1: Action Validation Framework

### The Problem

LLMs make mistakes:
- Malformed tool calls
- Invalid parameters
- Actions that violate policy
- Resource-intensive operations

Without validation, these propagate through the system.

### The Solution

Validate every action before execution:

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

async function validateAction(
  action: ToolCall,
  context: ValidationContext
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Schema validation
  const schemaResult = validateSchema(action);
  if (!schemaResult.valid) {
    errors.push({ type: 'schema', message: schemaResult.error });
  }

  // Policy validation
  const policyResult = await checkPolicy(action, context);
  if (!policyResult.allowed) {
    errors.push({ type: 'policy', message: policyResult.reason });
  }

  // Resource validation
  const resourceResult = checkResources(action, context);
  if (!resourceResult.withinLimits) {
    errors.push({ type: 'resource', message: resourceResult.reason });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

---

## Pattern 2: Policy-Based Validation

### The Problem

Different contexts require different rules:
- Development vs production
- Internal vs customer-facing
- Trusted vs untrusted inputs

Hard-coded rules don't scale.

### The Solution

Define policies declaratively:

```typescript
interface Policy {
  name: string;
  rules: PolicyRule[];
  defaultAction: 'allow' | 'deny';
}

interface PolicyRule {
  tool: string | RegExp;
  action: 'allow' | 'deny' | 'audit';
  condition?: (input: unknown, context: Context) => boolean;
}

const productionPolicy: Policy = {
  name: 'production',
  defaultAction: 'deny',  // Deny by default in production
  rules: [
    { tool: 'read_file', action: 'allow' },
    { tool: 'write_file', action: 'allow', condition: (input, ctx) =>
      !input.path.includes('/etc/') && !input.path.includes('..') },
    { tool: /execute.*/, action: 'audit' },  // Log all executions
    { tool: 'delete_file', action: 'deny' },
  ],
};
```

---

## Pattern 3: Subsumption Safety Layers

### The Problem

Goal-directed behavior can override safety:
- "Delete all files to clean up" (interpreted too literally)
- "Use admin credentials to access data" (privilege escalation)
- "Run this command in a loop" (resource exhaustion)

### The Solution

Implement Brooks-style subsumption:

```typescript
/**
 * Safety layers in priority order (lowest = highest priority).
 * Lower layers ALWAYS override higher layers.
 */
const safetyLayers: SafetyLayer[] = [
  // Layer 0: System integrity (cannot be overridden)
  {
    level: 0,
    name: 'system_integrity',
    check: (action) => !isSystemDestructive(action),
    onViolation: () => ({ block: true, reason: 'System integrity protected' }),
  },

  // Layer 1: Resource limits
  {
    level: 1,
    name: 'resource_limits',
    check: (action, ctx) => isWithinResourceLimits(action, ctx),
    onViolation: (action) => ({ block: true, reason: 'Resource limit exceeded' }),
  },

  // Layer 2: Policy compliance
  {
    level: 2,
    name: 'policy_compliance',
    check: (action, ctx) => isPolicyCompliant(action, ctx.policy),
    onViolation: (action) => ({ block: true, reason: 'Policy violation' }),
  },

  // Layer 3: Goal pursuit (can be blocked by any lower layer)
  {
    level: 3,
    name: 'goal_pursuit',
    check: () => true,  // Always allowed if lower layers pass
    onViolation: () => ({ block: false }),
  },
];

async function checkSafetyLayers(
  action: ToolCall,
  context: Context
): Promise<SafetyResult> {
  // Check layers in order (0 = highest priority)
  for (const layer of safetyLayers.sort((a, b) => a.level - b.level)) {
    const passed = await layer.check(action, context);
    if (!passed) {
      return layer.onViolation(action);
    }
  }
  return { block: false };
}
```

---

## Integration with the Loop

Validation integrates into the agent loop:

```typescript
for (const toolCall of response.toolCalls) {
  // Validate before execution
  const validation = await validateAction(toolCall, context);

  if (!validation.valid) {
    // Feed validation errors back to LLM
    results.push({
      type: 'tool_result',
      tool_use_id: toolCall.id,
      content: `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
      is_error: true,
    });
    continue;
  }

  // Check safety layers
  const safety = await checkSafetyLayers(toolCall, context);

  if (safety.block) {
    results.push({
      type: 'tool_result',
      tool_use_id: toolCall.id,
      content: `Blocked: ${safety.reason}`,
      is_error: true,
    });
    continue;
  }

  // Execute validated, safe action
  const result = await executeTool(toolCall);
  results.push(result);
}
```

---

## Trade-offs

### Validation Depth

| Level | Checks | Overhead | Use Case |
|-------|--------|----------|----------|
| Minimal | Schema only | ~1ms | Development, trusted env |
| Standard | Schema + Policy | ~5ms | Most production use |
| Strict | Schema + Policy + Audit | ~10ms | Sensitive operations |
| Paranoid | Full subsumption | ~20ms | Untrusted inputs |

### False Positive Handling

Overly strict validation blocks legitimate actions:

```typescript
// Allow user override for specific actions
interface ValidationContext {
  userOverrides?: Set<string>;  // Tool names user has approved
  escalationCallback?: (action: ToolCall) => Promise<boolean>;
}

// In validation:
if (!validation.valid && context.userOverrides?.has(action.name)) {
  // User has pre-approved this action type
  validation.valid = true;
}
```

---

## Files in This Section

- `validator.ts`: Core validation framework
- `policy.ts`: Policy definition and checking
- `examples/safety-layers.ts`: Subsumption-style safety implementation

---

## Further Reading

- **Report 26**: The Simple Architecture (60-70% reliability insight)
- **Report 28**: The Bitter Lesson (validation vs restriction)
- **Brooks (1986)**: Subsumption Architecture
- **Wiener (1948)**: Cybernetics and feedback control

