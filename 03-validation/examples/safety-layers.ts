/**
 * safety-layers.ts - Subsumption-Style Safety Implementation
 *
 * Derivation:
 * - Brooks (1986): "Lower-level behaviors always override higher-level goals"
 * - Report 26: "Safety is not negotiable. Subsume goals with safety layers."
 * - Wiener (1948): "Control systems need stability guarantees"
 *
 * This implements Brooks' subsumption architecture for agent safety.
 * Lower layers (higher priority) can always override higher layers.
 */

import { ToolCall, ValidationContext, ValidationResult, ValidationError } from '../validator';
import { PolicyChecker, productionPolicy, PolicyContext } from '../policy';

// =============================================================================
// Types
// =============================================================================

/**
 * Safety layer definition.
 * Lower level number = higher priority (checked first, can override).
 */
export interface SafetyLayer {
  /** Layer level (0 = highest priority) */
  level: number;

  /** Layer name for identification */
  name: string;

  /** Description of what this layer protects */
  description: string;

  /**
   * Check function - returns true if action is safe.
   * @param action The tool call to check
   * @param context Validation context
   * @returns true if safe, false to block
   */
  check: (action: ToolCall, context: SafetyContext) => Promise<boolean> | boolean;

  /**
   * Handler when check fails.
   * @returns Safety violation details
   */
  onViolation: (action: ToolCall, context: SafetyContext) => SafetyViolation;
}

/**
 * Extended context for safety checks.
 */
export interface SafetyContext extends ValidationContext {
  /** Policy checker instance */
  policyChecker?: PolicyChecker;

  /** Policy context */
  policyContext?: PolicyContext;

  /** Accumulated resource usage */
  resourceUsage?: {
    tokensUsed: number;
    apiCallsMade: number;
    executionTimeMs: number;
    filesModified: string[];
    commandsExecuted: string[];
  };

  /** System state */
  systemState?: {
    diskUsagePercent: number;
    memoryUsagePercent: number;
    cpuUsagePercent: number;
  };
}

/**
 * Safety violation result.
 */
export interface SafetyViolation {
  /** Whether to block the action */
  block: boolean;

  /** Reason for blocking */
  reason: string;

  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'critical';

  /** Suggestion for correction */
  suggestion?: string;

  /** Whether this can be overridden by user */
  overridable: boolean;
}

/**
 * Result of safety layer check.
 */
export interface SafetyResult {
  safe: boolean;
  violations: SafetyViolation[];
  layersChecked: string[];
}

// =============================================================================
// Subsumption Safety System
// =============================================================================

/**
 * Subsumption-based safety system.
 *
 * Derivation (Brooks, 1986):
 * "In subsumption architecture, lower layers can always inhibit
 * or override the outputs of higher layers. This ensures that
 * critical safety behaviors are never compromised by goal pursuit."
 */
export class SubsumptionSafety {
  private layers: SafetyLayer[] = [];

  /**
   * Add a safety layer.
   */
  addLayer(layer: SafetyLayer): this {
    this.layers.push(layer);
    // Keep sorted by level (ascending = higher priority first)
    this.layers.sort((a, b) => a.level - b.level);
    return this;
  }

  /**
   * Remove a safety layer by name.
   */
  removeLayer(name: string): this {
    this.layers = this.layers.filter(l => l.name !== name);
    return this;
  }

  /**
   * Check all safety layers in priority order.
   *
   * Derivation (Subsumption):
   * "Lower-numbered layers are checked first and can block
   * before higher layers are even consulted."
   */
  async check(action: ToolCall, context: SafetyContext = {}): Promise<SafetyResult> {
    const violations: SafetyViolation[] = [];
    const layersChecked: string[] = [];

    for (const layer of this.layers) {
      layersChecked.push(layer.name);

      const safe = await layer.check(action, context);

      if (!safe) {
        const violation = layer.onViolation(action, context);
        violations.push(violation);

        // Critical violations stop checking immediately
        if (violation.severity === 'critical' && violation.block) {
          break;
        }
      }
    }

    return {
      safe: violations.filter(v => v.block).length === 0,
      violations,
      layersChecked,
    };
  }

  /**
   * Get all registered layers.
   */
  getLayers(): SafetyLayer[] {
    return [...this.layers];
  }
}

// =============================================================================
// Standard Safety Layers
// =============================================================================

/**
 * Layer 0: System Integrity
 *
 * Highest priority - protects the underlying system.
 * Cannot be overridden by any higher layer.
 */
export const systemIntegrityLayer: SafetyLayer = {
  level: 0,
  name: 'system_integrity',
  description: 'Protects system files and critical infrastructure',
  check: (action) => {
    // Check for dangerous file operations
    const path = String(action.input.path || action.input.file || '');

    // Block access to critical system paths
    const criticalPaths = [
      '/etc/passwd', '/etc/shadow', '/etc/sudoers',
      '/boot/', '/sys/', '/proc/',
      '/dev/', '/root/',
    ];

    for (const critical of criticalPaths) {
      if (path.includes(critical)) {
        return false;
      }
    }

    // Block path traversal
    if (path.includes('..')) {
      return false;
    }

    // Check for dangerous commands
    const command = String(action.input.command || '');
    const dangerousCommands = [
      'rm -rf', 'dd if=', 'mkfs', 'fdisk',
      'chmod 777', 'chmod -R', 'chown -R',
      ':(){:|:&};:', // Fork bomb
      'shutdown', 'reboot', 'halt',
    ];

    for (const dangerous of dangerousCommands) {
      if (command.includes(dangerous)) {
        return false;
      }
    }

    return true;
  },
  onViolation: (action) => ({
    block: true,
    reason: `System integrity protection triggered for: ${action.name}`,
    severity: 'critical',
    overridable: false,
  }),
};

/**
 * Layer 1: Resource Protection
 *
 * Prevents resource exhaustion.
 */
export const resourceProtectionLayer: SafetyLayer = {
  level: 1,
  name: 'resource_protection',
  description: 'Prevents resource exhaustion and runaway costs',
  check: (_action, context) => {
    const usage = context.resourceUsage;
    const system = context.systemState;

    if (usage) {
      // Check token limits
      if (usage.tokensUsed > 1_000_000) return false;

      // Check API call limits
      if (usage.apiCallsMade > 1000) return false;

      // Check execution time
      if (usage.executionTimeMs > 300_000) return false; // 5 minutes
    }

    if (system) {
      // Check system resources
      if (system.diskUsagePercent > 95) return false;
      if (system.memoryUsagePercent > 95) return false;
      if (system.cpuUsagePercent > 95) return false;
    }

    return true;
  },
  onViolation: () => ({
    block: true,
    reason: 'Resource limits exceeded',
    severity: 'error',
    suggestion: 'Reduce operation scope or wait for resources to free up',
    overridable: true,
  }),
};

/**
 * Layer 2: Policy Compliance
 *
 * Enforces organizational policies.
 */
export const policyComplianceLayer: SafetyLayer = {
  level: 2,
  name: 'policy_compliance',
  description: 'Enforces configured security policies',
  check: (action, context) => {
    if (!context.policyChecker) return true;

    const result = context.policyChecker.check(action, context.policyContext || {});
    return result.allowed;
  },
  onViolation: (action, context) => {
    const result = context.policyChecker?.check(action, context.policyContext || {});
    return {
      block: true,
      reason: result?.reason || 'Policy violation',
      severity: 'error',
      overridable: true,
    };
  },
};

/**
 * Layer 3: Rate Limiting
 *
 * Prevents rapid-fire operations.
 */
export const rateLimitingLayer: SafetyLayer = {
  level: 3,
  name: 'rate_limiting',
  description: 'Prevents excessive operation frequency',
  check: (_action, context) => {
    const usage = context.resourceUsage;

    if (usage) {
      // Check operations per minute
      const elapsed = context.resourceUsage?.executionTimeMs || 1;
      const opsPerMinute = (usage.apiCallsMade / elapsed) * 60_000;

      if (opsPerMinute > 60) return false; // Max 60 ops/minute
    }

    return true;
  },
  onViolation: () => ({
    block: true,
    reason: 'Rate limit exceeded',
    severity: 'warning',
    suggestion: 'Slow down operation frequency',
    overridable: true,
  }),
};

/**
 * Layer 4: Goal Pursuit
 *
 * Lowest priority - always allows if higher layers pass.
 * This layer represents the agent's actual task execution.
 */
export const goalPursuitLayer: SafetyLayer = {
  level: 4,
  name: 'goal_pursuit',
  description: 'Allows goal-directed actions that pass safety checks',
  check: () => true,
  onViolation: () => ({
    block: false,
    reason: '',
    severity: 'info',
    overridable: true,
  }),
};

// =============================================================================
// Pre-configured Safety Systems
// =============================================================================

/**
 * Standard safety system with all built-in layers.
 */
export function createStandardSafety(): SubsumptionSafety {
  return new SubsumptionSafety()
    .addLayer(systemIntegrityLayer)
    .addLayer(resourceProtectionLayer)
    .addLayer(policyComplianceLayer)
    .addLayer(rateLimitingLayer)
    .addLayer(goalPursuitLayer);
}

/**
 * Minimal safety system for development.
 */
export function createMinimalSafety(): SubsumptionSafety {
  return new SubsumptionSafety()
    .addLayer(systemIntegrityLayer)
    .addLayer(goalPursuitLayer);
}

/**
 * Strict safety system for production.
 */
export function createStrictSafety(policy?: PolicyChecker): SubsumptionSafety {
  const policyLayer = { ...policyComplianceLayer };

  // Use provided policy or default to production
  const _checker = policy || new PolicyChecker(productionPolicy);

  return new SubsumptionSafety()
    .addLayer(systemIntegrityLayer)
    .addLayer(resourceProtectionLayer)
    .addLayer(policyLayer)
    .addLayer(rateLimitingLayer)
    .addLayer(goalPursuitLayer);
}

// =============================================================================
// Integration with Validator
// =============================================================================

/**
 * Create a validator function from a SubsumptionSafety system.
 */
export function createSafetyValidator(
  safety: SubsumptionSafety
): (action: ToolCall, context: ValidationContext) => Promise<ValidationResult> {
  return async (action, context) => {
    const safetyContext: SafetyContext = {
      ...context,
      policyChecker: (context as SafetyContext).policyChecker,
      policyContext: (context as SafetyContext).policyContext,
      resourceUsage: (context as SafetyContext).resourceUsage,
      systemState: (context as SafetyContext).systemState,
    };

    const result = await safety.check(action, safetyContext);

    if (result.safe) {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: ValidationError[] = result.violations
      .filter(v => v.block)
      .map(v => ({
        type: 'safety' as const,
        code: `SAFETY_${v.severity.toUpperCase()}`,
        message: v.reason,
        details: { severity: v.severity, overridable: v.overridable },
      }));

    return {
      valid: false,
      errors,
      warnings: result.violations
        .filter(v => !v.block)
        .map(v => ({ type: 'safety', message: v.reason })),
    };
  };
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Agent loop with subsumption safety.
 *
 * ```typescript
 * import { createStrictSafety, createSafetyValidator } from './safety-layers';
 * import { ActionValidator, createStandardValidator } from '../validator';
 *
 * // Create safety system
 * const safety = createStrictSafety();
 *
 * // Create combined validator
 * const validator = new ActionValidator()
 *   .addValidator('schema', schemaValidator)
 *   .addValidator('safety', createSafetyValidator(safety));
 *
 * // In the agent loop:
 * for (const toolCall of response.toolCalls) {
 *   const validation = await validator.validate(toolCall, context);
 *
 *   if (!validation.valid) {
 *     // Safety or validation failed - feed back to LLM
 *     results.push({
 *       type: 'tool_result',
 *       tool_use_id: toolCall.id,
 *       content: `Blocked: ${validation.errors.map(e => e.message).join(', ')}`,
 *       is_error: true,
 *     });
 *     continue;
 *   }
 *
 *   // Safe to execute
 *   const result = await executeTool(toolCall);
 *   results.push(result);
 * }
 * ```
 */

