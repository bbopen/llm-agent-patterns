# Security

**Principle**: Break the Lethal Trifecta. Never combine private data, untrusted input, and external actions in a single agent without isolation.

---

## The Derivation

### From Security Research (Simon Willison)

**Simon Willison** identified the fundamental vulnerability:

> "Prompt injection isn't just a bug, it's a fundamental architectural flaw. Any system that combines untrusted input with privileged actions is inherently vulnerable."

The Lethal Trifecta:
1. **Private Data**: Information the agent can access (databases, files, secrets)
2. **Untrusted Input**: Content from external sources (user input, web pages, emails)
3. **External Actions**: Ability to affect the world (send emails, execute code, modify data)

When all three combine, attackers can inject prompts that:
- Exfiltrate private data through external actions
- Execute unauthorized operations using the agent's privileges
- Persist malicious instructions in the agent's memory

### From Classical Security (Schneier, 1999)

**Bruce Schneier** established:

> "Security is a process, not a product. Defense in depth requires multiple independent barriers."

Applied to agents:
- Input sanitization is one barrier
- Output validation is another
- Capability isolation is a third
- Any single barrier may fail; multiple barriers compound security

### From Production Experience (Reports 26, 28)

**Report 26** observed:
> "Agents with full capabilities and no isolation are inherently dangerous. Isolation provides the missing security layer."

**Report 28** warned:
> "Complete action spaces require complete validation. The more capable the agent, the more critical the security model."

---

## Pattern 1: The Trifecta Assessment

### The Problem

Most production agents have all three trifecta elements:
- They access internal systems (private data)
- They process user requests (untrusted input)
- They call tools that modify state (external actions)

This creates a fundamentally vulnerable architecture.

### The Solution

Assess and mitigate each leg of the trifecta:

```typescript
interface TrifectaAssessment {
  privateData: {
    present: boolean;
    types: ('database' | 'filesystem' | 'secrets' | 'internal_api')[];
    sensitivity: 'low' | 'medium' | 'high' | 'critical';
  };
  untrustedInput: {
    present: boolean;
    sources: ('user' | 'web' | 'email' | 'file')[];
    sanitized: boolean;
  };
  externalActions: {
    present: boolean;
    types: ('execute' | 'network' | 'write' | 'delete')[];
    reversible: boolean;
  };
}

function assessTrifectaRisk(assessment: TrifectaAssessment): {
  risk: 'low' | 'medium' | 'high' | 'critical';
  mitigations: string[];
} {
  const hasAll = assessment.privateData.present &&
                 assessment.untrustedInput.present &&
                 assessment.externalActions.present;

  if (!hasAll) {
    return { risk: 'low', mitigations: [] };
  }

  // All three present - high risk by default
  const mitigations: string[] = [];

  // Check for sanitization
  if (!assessment.untrustedInput.sanitized) {
    mitigations.push('Add input sanitization');
  }

  // Check for reversibility
  if (!assessment.externalActions.reversible) {
    mitigations.push('Add confirmation for irreversible actions');
  }

  // Check sensitivity
  if (assessment.privateData.sensitivity === 'critical') {
    mitigations.push('Isolate high-sensitivity data access');
  }

  return {
    risk: mitigations.length === 0 ? 'medium' : 'critical',
    mitigations,
  };
}
```

---

## Pattern 2: Capability Isolation

### The Problem

A single agent with full access to everything can be compromised entirely with one successful prompt injection.

### The Solution

Separate capabilities into isolated contexts:

```typescript
// Instead of one omnipotent agent:
const dangerousAgent = createAgent({
  tools: [
    readDatabase,      // Private data
    processUserInput,  // Untrusted input
    sendEmail,         // External actions
    deleteFiles,       // Destructive capability
  ],
});

// Use isolated agents with limited capabilities:
const readOnlyAgent = createAgent({
  tools: [readDatabase, queryLogs],  // Can read but not write
});

const actionAgent = createAgent({
  tools: [sendEmail, createTicket],  // Can act but not read sensitive data
  inputSource: 'internal',            // No direct user input
});

// Orchestrator passes sanitized data between them
const orchestrator = createOrchestrator({
  agents: { readOnlyAgent, actionAgent },
  sanitizer: sanitizeForActionAgent,  // Filter sensitive data
});
```

---

## Pattern 3: Sandboxed Execution

### The Problem

Execute tools can run arbitrary code. Without isolation:
- Command injection can compromise the host
- Malicious code can access the full filesystem
- Resource exhaustion can affect other services

### The Solution

Execute code in isolated sandboxes:

```typescript
interface SandboxConfig {
  // Filesystem isolation
  rootDir: string;           // Chroot-like boundary
  readOnly: boolean;         // Prevent writes
  allowedPaths: string[];    // Whitelist of accessible paths

  // Process isolation
  timeout: number;           // Kill after timeout
  maxMemory: number;         // Memory limit
  maxCpu: number;            // CPU limit

  // Network isolation
  networkEnabled: boolean;   // Allow network access
  allowedHosts?: string[];   // Whitelist of hosts
}

const strictSandbox: SandboxConfig = {
  rootDir: '/sandbox',
  readOnly: false,
  allowedPaths: ['/sandbox/workspace'],
  timeout: 30_000,
  maxMemory: 512 * 1024 * 1024,  // 512MB
  maxCpu: 1,
  networkEnabled: false,
};

async function executeInSandbox(
  command: string,
  config: SandboxConfig
): Promise<string> {
  // Implementation uses containers, VMs, or process isolation
  // See sandbox.ts for full implementation
}
```

---

## Pattern 4: Input Sanitization

### The Problem

Prompt injection hides in any text:
- User messages
- File contents
- Web page text
- API responses

### The Solution

Sanitize all untrusted content:

```typescript
interface SanitizationResult {
  safe: boolean;
  sanitized: string;
  warnings: string[];
  blocked: string[];
}

function sanitizeInput(
  input: string,
  config: SanitizationConfig
): SanitizationResult {
  const warnings: string[] = [];
  const blocked: string[] = [];
  let sanitized = input;

  // Remove known prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      blocked.push(`Pattern: ${pattern.source}`);
      sanitized = sanitized.replace(pattern, '[REMOVED]');
    }
  }

  // Truncate excessive length (potential context stuffing)
  if (sanitized.length > config.maxLength) {
    warnings.push(`Truncated from ${input.length} to ${config.maxLength}`);
    sanitized = sanitized.substring(0, config.maxLength);
  }

  // Remove invisible characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  return {
    safe: blocked.length === 0,
    sanitized,
    warnings,
    blocked,
  };
}
```

---

## Defense in Depth

Layer multiple defenses:

```
Layer 1: Input Sanitization
├── Remove known injection patterns
├── Truncate excessive input
└── Validate format expectations

Layer 2: Capability Isolation
├── Separate read-only and write agents
├── Filter data between agent boundaries
└── Limit tool access per context

Layer 3: Action Validation (see 03-validation)
├── Policy-based permission checks
├── Subsumption safety layers
└── Deny dangerous patterns

Layer 4: Sandboxed Execution
├── Filesystem isolation
├── Network restrictions
└── Resource limits

Layer 5: Output Filtering
├── Detect sensitive data in outputs
├── Block credential exposure
└── Audit all external actions
```

Any single layer may be bypassed. Multiple layers make compromise exponentially harder.

---

## Trade-offs

### Isolation Level

| Level | Security | Capability | Use Case |
|-------|----------|------------|----------|
| None | Low | Full | Development only |
| Logical | Medium | High | Internal tools |
| Process | High | Medium | External input |
| Container | Very High | Medium | Untrusted code |
| VM | Maximum | Low | Hostile environments |

### Input Sanitization Aggressiveness

| Level | False Positives | Security | Use Case |
|-------|-----------------|----------|----------|
| Minimal | Low | Low | Trusted sources |
| Standard | Medium | Medium | General use |
| Aggressive | High | High | Public-facing |
| Paranoid | Very High | Maximum | High-value targets |

---

## Files in This Section

- `trifecta.ts`: Trifecta assessment and mitigation
- `sandbox.ts`: Execution isolation implementation
- `examples/secure-agent.ts`: Agent with full security stack

---

## Further Reading

- **Simon Willison**: Prompt Injection research
- **Report 26**: The Simple Architecture (isolation patterns)
- **Report 28**: The Bitter Lesson (capability/security balance)
- **Bruce Schneier**: Security engineering principles

