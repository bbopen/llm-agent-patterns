/**
 * policy.ts - Policy Definition and Checking
 *
 * Derivation:
 * - Report 28: "Validation layer handles safety. Don't restrict capabilities."
 * - Report 26: "Deterministic guards around stochastic core"
 * - Production Practice: Declarative policies scale better than hard-coded rules
 *
 * Policies define what actions are allowed in different contexts.
 * This separates "what is possible" (tools) from "what is permitted" (policy).
 */

import { ToolCall, ValidationResult, ValidationError } from './validator';

// =============================================================================
// Types
// =============================================================================

/**
 * Policy action types.
 */
export type PolicyAction = 'allow' | 'deny' | 'audit' | 'ask';

/**
 * Policy rule that matches tools and determines action.
 */
export interface PolicyRule {
  /** Tool name pattern (string for exact, RegExp for pattern) */
  tool: string | RegExp;

  /** Action to take when rule matches */
  action: PolicyAction;

  /** Optional condition function for fine-grained control */
  condition?: (input: Record<string, unknown>, context: PolicyContext) => boolean;

  /** Reason for this rule (for audit logging) */
  reason?: string;

  /** Priority (higher = checked first) */
  priority?: number;
}

/**
 * Complete policy definition.
 */
export interface Policy {
  /** Policy name for identification */
  name: string;

  /** Version for tracking changes */
  version: string;

  /** Policy description */
  description?: string;

  /** Ordered list of rules */
  rules: PolicyRule[];

  /** Default action when no rule matches */
  defaultAction: PolicyAction;

  /** Whether to log all decisions */
  auditAll?: boolean;
}

/**
 * Context provided to policy checks.
 */
export interface PolicyContext {
  /** Current user identifier */
  userId?: string;

  /** User's role or permission level */
  userRole?: 'admin' | 'user' | 'service' | 'anonymous';

  /** Environment context */
  environment?: 'development' | 'staging' | 'production';

  /** Session metadata */
  session?: {
    id: string;
    startedAt: number;
    actionsPerformed: number;
  };

  /** Custom context data */
  custom?: Record<string, unknown>;
}

/**
 * Result of a policy check.
 */
export interface PolicyCheckResult {
  allowed: boolean;
  action: PolicyAction;
  matchedRule?: PolicyRule;
  reason: string;
  auditEntry?: PolicyAuditEntry;
}

/**
 * Audit log entry for policy decisions.
 */
export interface PolicyAuditEntry {
  timestamp: number;
  toolCall: ToolCall;
  context: PolicyContext;
  decision: PolicyAction;
  rule?: string;
  reason: string;
}

// =============================================================================
// Policy Checker
// =============================================================================

/**
 * Policy enforcement engine.
 *
 * Derivation (Report 28):
 * "Don't restrict capabilities—validate actions.
 * Policies define the validation rules declaratively."
 */
export class PolicyChecker {
  private policy: Policy;
  private auditLog: PolicyAuditEntry[] = [];

  constructor(policy: Policy) {
    this.policy = policy;
  }

  /**
   * Check if an action is allowed by the policy.
   */
  check(action: ToolCall, context: PolicyContext = {}): PolicyCheckResult {
    // Sort rules by priority (higher first)
    const sortedRules = [...this.policy.rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    // Find first matching rule
    for (const rule of sortedRules) {
      if (this.ruleMatches(rule, action, context)) {
        const result = this.applyRule(rule, action, context);

        // Audit logging
        if (this.policy.auditAll || rule.action === 'audit') {
          this.logAudit(action, context, result);
        }

        return result;
      }
    }

    // No rule matched - use default
    const result: PolicyCheckResult = {
      allowed: this.policy.defaultAction === 'allow',
      action: this.policy.defaultAction,
      reason: `No matching rule, default action: ${this.policy.defaultAction}`,
    };

    if (this.policy.auditAll) {
      this.logAudit(action, context, result);
    }

    return result;
  }

  /**
   * Check if a rule matches an action.
   */
  private ruleMatches(
    rule: PolicyRule,
    action: ToolCall,
    context: PolicyContext
  ): boolean {
    // Check tool name
    const toolMatches = typeof rule.tool === 'string'
      ? rule.tool === action.name
      : rule.tool.test(action.name);

    if (!toolMatches) return false;

    // Check condition if present
    if (rule.condition) {
      return rule.condition(action.input, context);
    }

    return true;
  }

  /**
   * Apply a matched rule.
   */
  private applyRule(
    rule: PolicyRule,
    action: ToolCall,
    _context: PolicyContext
  ): PolicyCheckResult {
    const allowed = rule.action === 'allow' || rule.action === 'audit';

    return {
      allowed,
      action: rule.action,
      matchedRule: rule,
      reason: rule.reason || `Matched rule for ${action.name}: ${rule.action}`,
    };
  }

  /**
   * Log an audit entry.
   */
  private logAudit(
    action: ToolCall,
    context: PolicyContext,
    result: PolicyCheckResult
  ): void {
    const entry: PolicyAuditEntry = {
      timestamp: Date.now(),
      toolCall: action,
      context,
      decision: result.action,
      rule: result.matchedRule?.reason,
      reason: result.reason,
    };

    this.auditLog.push(entry);
    result.auditEntry = entry;
  }

  /**
   * Get audit log.
   */
  getAuditLog(): PolicyAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear audit log.
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /**
   * Get the current policy.
   */
  getPolicy(): Policy {
    return this.policy;
  }

  /**
   * Update the policy.
   */
  setPolicy(policy: Policy): void {
    this.policy = policy;
  }
}

// =============================================================================
// Policy Validator Integration
// =============================================================================

/**
 * Create a validator function from a PolicyChecker.
 *
 * Integrates policy checking into the validation framework.
 */
export function createPolicyValidator(
  checker: PolicyChecker
): (action: ToolCall, context: { custom?: { policyContext?: PolicyContext } }) => Promise<ValidationResult> {
  return async (action, validationContext) => {
    const policyContext = validationContext.custom?.policyContext || {};
    const result = checker.check(action, policyContext);

    if (result.allowed) {
      return {
        valid: true,
        errors: [],
        warnings: result.action === 'audit' ? [{
          type: 'audit',
          message: `Action audited: ${result.reason}`,
        }] : [],
      };
    }

    const error: ValidationError = {
      type: 'policy',
      code: 'POLICY_VIOLATION',
      message: result.reason,
      details: {
        action: result.action,
        matchedRule: result.matchedRule?.reason,
      },
    };

    return {
      valid: false,
      errors: [error],
      warnings: [],
    };
  };
}

// =============================================================================
// Pre-defined Policies
// =============================================================================

/**
 * Development policy - permissive for rapid iteration.
 *
 * Derivation (Report 28):
 * "In development, complete action space enables exploration.
 * Audit everything for debugging."
 */
export const developmentPolicy: Policy = {
  name: 'development',
  version: '1.0.0',
  description: 'Permissive policy for development environments',
  defaultAction: 'allow',
  auditAll: true,
  rules: [
    // Deny destructive system operations even in dev
    {
      tool: /^(delete_|remove_|drop_)/,
      action: 'audit',
      reason: 'Destructive operations audited in development',
      priority: 100,
    },
  ],
};

/**
 * Production policy - restrictive with explicit allows.
 *
 * Derivation (Report 26):
 * "Production requires deterministic guards.
 * Deny by default, allow explicitly."
 */
export const productionPolicy: Policy = {
  name: 'production',
  version: '1.0.0',
  description: 'Restrictive policy for production environments',
  defaultAction: 'deny',
  auditAll: true,
  rules: [
    // Read operations are generally safe
    {
      tool: /^(read_|get_|list_|search_)/,
      action: 'allow',
      reason: 'Read operations allowed',
      priority: 50,
    },

    // Write operations with path restrictions
    {
      tool: 'write_file',
      action: 'allow',
      condition: (input) => {
        const path = String(input.path || '');
        // Only allow writes to specific directories
        return path.startsWith('/tmp/') ||
               path.startsWith('/var/app/data/') ||
               path.startsWith('./output/');
      },
      reason: 'Write allowed to safe directories only',
      priority: 60,
    },

    // Block all execute operations by default
    {
      tool: /^execute/,
      action: 'deny',
      reason: 'Command execution blocked in production',
      priority: 80,
    },

    // Allow specific safe commands
    {
      tool: 'execute_command',
      action: 'allow',
      condition: (input) => {
        const cmd = String(input.command || '');
        const safeCommands = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc'];
        const firstWord = cmd.split(/\s+/)[0] ?? '';
        return safeCommands.includes(firstWord);
      },
      reason: 'Safe read-only commands allowed',
      priority: 90,
    },

    // Block all delete operations
    {
      tool: /^(delete_|remove_|drop_)/,
      action: 'deny',
      reason: 'Destructive operations blocked in production',
      priority: 100,
    },
  ],
};

/**
 * Read-only policy for exploration tasks.
 *
 * Derivation (Report 11):
 * "Claude Code uses read-only tools for exploration.
 * Match tools to task phase."
 */
export const readOnlyPolicy: Policy = {
  name: 'read-only',
  version: '1.0.0',
  description: 'Read-only policy for exploration tasks',
  defaultAction: 'deny',
  rules: [
    {
      tool: /^(read_|get_|list_|search_|query_)/,
      action: 'allow',
      reason: 'Read operations allowed',
    },
  ],
};

// =============================================================================
// Policy Builder
// =============================================================================

/**
 * Fluent builder for creating policies.
 */
export class PolicyBuilder {
  private policy: Policy;

  constructor(name: string) {
    this.policy = {
      name,
      version: '1.0.0',
      rules: [],
      defaultAction: 'deny',
    };
  }

  version(v: string): this {
    this.policy.version = v;
    return this;
  }

  description(d: string): this {
    this.policy.description = d;
    return this;
  }

  defaultAllow(): this {
    this.policy.defaultAction = 'allow';
    return this;
  }

  defaultDeny(): this {
    this.policy.defaultAction = 'deny';
    return this;
  }

  auditAll(): this {
    this.policy.auditAll = true;
    return this;
  }

  allow(tool: string | RegExp, options?: Partial<PolicyRule>): this {
    this.policy.rules.push({ tool, action: 'allow', ...options });
    return this;
  }

  deny(tool: string | RegExp, options?: Partial<PolicyRule>): this {
    this.policy.rules.push({ tool, action: 'deny', ...options });
    return this;
  }

  audit(tool: string | RegExp, options?: Partial<PolicyRule>): this {
    this.policy.rules.push({ tool, action: 'audit', ...options });
    return this;
  }

  build(): Policy {
    return { ...this.policy };
  }
}

/**
 * Create a policy using the builder.
 *
 * @example
 * const policy = buildPolicy('custom')
 *   .defaultDeny()
 *   .allow(/^read_/)
 *   .allow('write_file', { condition: (i) => !i.path.includes('..') })
 *   .deny(/^execute/)
 *   .build();
 */
export function buildPolicy(name: string): PolicyBuilder {
  return new PolicyBuilder(name);
}

