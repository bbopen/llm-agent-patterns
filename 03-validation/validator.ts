/**
 * validator.ts - Action Validation Framework
 *
 * Derivation:
 * - Wiener (1948): Controller must be deterministic for stability
 * - Report 26: "60-70% reliable per step; validation provides the rest"
 * - Report 28: "Validation layer handles safety, not restricted capabilities"
 *
 * This framework validates every action before execution,
 * transforming 60-70% per-step reliability into acceptable system reliability.
 */

import { z } from 'zod';

// =============================================================================
// Types
// =============================================================================

/**
 * Tool call to validate.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Validation error with structured information.
 */
export interface ValidationError {
  type: 'schema' | 'policy' | 'resource' | 'safety' | 'custom';
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation warning (non-blocking).
 */
export interface ValidationWarning {
  type: string;
  message: string;
  suggestion?: string;
}

/**
 * Complete validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata?: {
    validatedAt: number;
    validators: string[];
  };
}

/**
 * Context available during validation.
 */
export interface ValidationContext {
  /** Current user/session identifier */
  userId?: string;

  /** Active policy name */
  policyName?: string;

  /** Resource usage so far */
  resourceUsage?: {
    tokensUsed: number;
    apiCallsMade: number;
    executionTimeMs: number;
  };

  /** User-approved tool overrides */
  userOverrides?: Set<string>;

  /** Custom context data */
  custom?: Record<string, unknown>;
}

/**
 * Individual validator function.
 */
export type ValidatorFn = (
  action: ToolCall,
  context: ValidationContext
) => Promise<ValidationResult>;

// =============================================================================
// Core Validator
// =============================================================================

/**
 * Composable action validator.
 *
 * Derivation (Cybernetics):
 * "The controller must provide deterministic behavior.
 * Compose multiple validators for defense in depth."
 */
export class ActionValidator {
  private validators: Map<string, ValidatorFn> = new Map();

  /**
   * Register a validator.
   */
  addValidator(name: string, validator: ValidatorFn): this {
    this.validators.set(name, validator);
    return this;
  }

  /**
   * Remove a validator.
   */
  removeValidator(name: string): this {
    this.validators.delete(name);
    return this;
  }

  /**
   * Validate an action through all registered validators.
   *
   * Derivation (Defense in Depth):
   * "Multiple validation layers catch different error types.
   * Any single validator failing blocks the action."
   */
  async validate(
    action: ToolCall,
    context: ValidationContext = {}
  ): Promise<ValidationResult> {
    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];
    const validatorNames: string[] = [];

    for (const [name, validator] of this.validators) {
      validatorNames.push(name);

      try {
        const result = await validator(action, context);
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
      } catch (error) {
        // Validator threw - treat as validation failure
        allErrors.push({
          type: 'custom',
          code: 'VALIDATOR_ERROR',
          message: `Validator ${name} failed: ${error}`,
        });
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      metadata: {
        validatedAt: Date.now(),
        validators: validatorNames,
      },
    };
  }
}

// =============================================================================
// Built-in Validators
// =============================================================================

/**
 * Schema validator using Zod.
 *
 * Derivation (Report 10):
 * "Tool schemas should use JSON Schema with additionalProperties: false.
 * Validate inputs match the expected structure."
 */
export function createSchemaValidator(
  schemas: Map<string, z.ZodType>
): ValidatorFn {
  return async (action, _context) => {
    const schema = schemas.get(action.name);

    if (!schema) {
      // No schema registered - warn but allow
      return {
        valid: true,
        errors: [],
        warnings: [{
          type: 'schema',
          message: `No schema registered for tool: ${action.name}`,
          suggestion: 'Register a schema for type-safe validation',
        }],
      };
    }

    const result = schema.safeParse(action.input);

    if (result.success) {
      return { valid: true, errors: [], warnings: [] };
    }

    // Convert Zod errors to ValidationErrors
    const errors: ValidationError[] = result.error.issues.map(issue => ({
      type: 'schema' as const,
      code: 'SCHEMA_VALIDATION_FAILED',
      message: issue.message,
      field: issue.path.join('.'),
      details: { zodIssue: issue },
    }));

    return { valid: false, errors, warnings: [] };
  };
}

/**
 * Resource limit validator.
 *
 * Derivation (Report 26):
 * "Resource limits prevent runaway costs.
 * Check before execution, not after."
 */
export interface ResourceLimits {
  maxTokensPerSession: number;
  maxApiCallsPerSession: number;
  maxExecutionTimeMs: number;
  maxSingleOperationCost?: number;
}

export function createResourceValidator(limits: ResourceLimits): ValidatorFn {
  return async (_action, context) => {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const usage = context.resourceUsage || {
      tokensUsed: 0,
      apiCallsMade: 0,
      executionTimeMs: 0,
    };

    // Check token limit
    if (usage.tokensUsed >= limits.maxTokensPerSession) {
      errors.push({
        type: 'resource',
        code: 'TOKEN_LIMIT_EXCEEDED',
        message: `Token limit exceeded: ${usage.tokensUsed}/${limits.maxTokensPerSession}`,
      });
    } else if (usage.tokensUsed >= limits.maxTokensPerSession * 0.8) {
      warnings.push({
        type: 'resource',
        message: `Approaching token limit: ${usage.tokensUsed}/${limits.maxTokensPerSession}`,
      });
    }

    // Check API call limit
    if (usage.apiCallsMade >= limits.maxApiCallsPerSession) {
      errors.push({
        type: 'resource',
        code: 'API_CALL_LIMIT_EXCEEDED',
        message: `API call limit exceeded: ${usage.apiCallsMade}/${limits.maxApiCallsPerSession}`,
      });
    }

    // Check execution time limit
    if (usage.executionTimeMs >= limits.maxExecutionTimeMs) {
      errors.push({
        type: 'resource',
        code: 'EXECUTION_TIME_EXCEEDED',
        message: `Execution time limit exceeded: ${usage.executionTimeMs}ms/${limits.maxExecutionTimeMs}ms`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  };
}

/**
 * Pattern-based deny list validator.
 *
 * Derivation (Security):
 * "Some patterns are always dangerous.
 * Block known-bad patterns regardless of context."
 */
export interface DenyPattern {
  pattern: RegExp;
  field: string;
  reason: string;
}

export function createDenyListValidator(patterns: DenyPattern[]): ValidatorFn {
  return async (action, _context) => {
    const errors: ValidationError[] = [];

    for (const { pattern, field, reason } of patterns) {
      const value = getNestedValue(action.input, field);

      if (value !== undefined && pattern.test(String(value))) {
        errors.push({
          type: 'safety',
          code: 'DENY_PATTERN_MATCHED',
          message: reason,
          field,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  };
}

// Helper to get nested object values
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// =============================================================================
// Pre-configured Validator Sets
// =============================================================================

/**
 * Standard security deny patterns.
 *
 * These patterns are blocked in all contexts.
 */
export const securityDenyPatterns: DenyPattern[] = [
  // Path traversal
  {
    pattern: /\.\.\//,
    field: 'path',
    reason: 'Path traversal detected',
  },
  // Sensitive paths
  {
    pattern: /\/etc\/(passwd|shadow|sudoers)/,
    field: 'path',
    reason: 'Access to sensitive system files blocked',
  },
  // Command injection in shell commands
  {
    pattern: /[;&|`$()]/,
    field: 'command',
    reason: 'Potential command injection detected',
  },
  // SQL injection patterns
  {
    pattern: /('|"|;|--|\bOR\b|\bAND\b.*=)/i,
    field: 'sql',
    reason: 'Potential SQL injection detected',
  },
];

/**
 * Create a standard validator with common checks.
 */
export function createStandardValidator(config: {
  schemas?: Map<string, z.ZodType>;
  resourceLimits?: ResourceLimits;
  denyPatterns?: DenyPattern[];
}): ActionValidator {
  const validator = new ActionValidator();

  // Schema validation
  if (config.schemas) {
    validator.addValidator('schema', createSchemaValidator(config.schemas));
  }

  // Resource validation
  if (config.resourceLimits) {
    validator.addValidator('resource', createResourceValidator(config.resourceLimits));
  }

  // Security deny patterns
  const patterns = config.denyPatterns || securityDenyPatterns;
  validator.addValidator('security', createDenyListValidator(patterns));

  return validator;
}

// =============================================================================
// Validation Result Helpers
// =============================================================================

/**
 * Format validation result for LLM feedback.
 *
 * Derivation (Feedback Loop):
 * "Errors must be communicated back to the LLM in a useful format.
 * Clear error messages enable self-correction."
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid) {
    return 'Validation passed';
  }

  const errorMessages = result.errors.map(e => {
    const fieldInfo = e.field ? ` (field: ${e.field})` : '';
    return `- ${e.type.toUpperCase()}: ${e.message}${fieldInfo}`;
  });

  return `Validation failed:\n${errorMessages.join('\n')}`;
}

/**
 * Check if validation should be retried with corrections.
 *
 * Some errors are correctable (typos, format issues).
 * Others are not (policy violations, resource exhaustion).
 */
export function isRetryable(result: ValidationResult): boolean {
  // Schema errors might be correctable
  const hasOnlySchemaErrors = result.errors.every(e => e.type === 'schema');

  // Resource and safety errors are not retryable
  const hasBlockingErrors = result.errors.some(e =>
    e.type === 'resource' || e.type === 'safety'
  );

  return hasOnlySchemaErrors && !hasBlockingErrors;
}

