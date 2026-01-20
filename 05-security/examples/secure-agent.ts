/**
 * secure-agent.ts - Agent with Full Security Stack
 *
 * Derivation:
 * - Willison: "Break the Lethal Trifecta through isolation"
 * - Schneier: "Defense in depth requires multiple independent barriers"
 * - Report 26: "Isolation provides the missing security layer"
 *
 * This demonstrates a production-ready security configuration
 * combining all security patterns from this section.
 */

import {
  TrifectaAssessor,
  TrifectaAssessment,
  sanitizeInput,
  filterSensitiveOutput,
  SanitizationConfig,
} from '../trifecta';
import {
  FilesystemSandbox,
  createStrictSandbox,
  validateCommand,
} from '../sandbox';
import { Tool, ToolResult } from '../../02-tool-design/tool-types';
import { ActionValidator, createStandardValidator } from '../../03-validation/validator';
import { PolicyChecker, productionPolicy } from '../../03-validation/policy';
import { createSafetyValidator, createStrictSafety } from '../../03-validation/examples/safety-layers';

// =============================================================================
// Secure Agent Configuration
// =============================================================================

/**
 * Security configuration for an agent.
 */
export interface SecurityConfig {
  /** Trifecta assessment for the agent */
  trifecta: TrifectaAssessment;

  /** Input sanitization config */
  sanitization: SanitizationConfig;

  /** Whether to filter sensitive output */
  filterOutput: boolean;

  /** Allowed output data types */
  allowedOutputTypes?: string[];

  /** Sandbox config for code execution */
  sandboxEnabled: boolean;

  /** Policy to enforce */
  policyName: 'development' | 'production' | 'read-only';

  /** Custom validation rules */
  customValidation?: (action: any) => Promise<boolean>;
}

/**
 * Secure agent context.
 */
export interface SecureContext {
  /** Security configuration */
  config: SecurityConfig;

  /** Sandbox instance (if enabled) */
  sandbox?: FilesystemSandbox;

  /** Validator instance */
  validator: ActionValidator;

  /** Policy checker instance */
  policyChecker: PolicyChecker;

  /** Audit log */
  auditLog: AuditEntry[];
}

/**
 * Audit log entry.
 */
export interface AuditEntry {
  timestamp: number;
  type: 'input' | 'action' | 'output' | 'security';
  action: string;
  details: Record<string, unknown>;
  blocked: boolean;
  reason?: string;
}

// =============================================================================
// Secure Agent Factory
// =============================================================================

/**
 * Create a secure agent context.
 *
 * Derivation (Defense in Depth):
 * "Layer multiple independent security controls.
 * Any single control may fail; multiple controls compound security."
 */
export async function createSecureContext(
  config: Partial<SecurityConfig> = {}
): Promise<SecureContext> {
  // Default trifecta assessment (assume worst case)
  const defaultTrifecta: TrifectaAssessment = {
    privateData: {
      present: true,
      types: ['filesystem'],
      sensitivity: 'medium',
      encrypted: false,
      accessControlled: true,
    },
    untrustedInput: {
      present: true,
      sources: ['user_direct'],
      sanitized: true,  // We'll sanitize
      validated: true,  // We'll validate
      truncated: true,  // We'll truncate
    },
    externalActions: {
      present: true,
      types: ['execute_code', 'file_write'],
      reversible: true,
      confirmed: false,
      audited: true,  // We'll audit
    },
  };

  const fullConfig: SecurityConfig = {
    trifecta: config.trifecta || defaultTrifecta,
    sanitization: config.sanitization || {
      maxLength: 10000,
      removeInvisible: true,
      removePatterns: true,
    },
    filterOutput: config.filterOutput ?? true,
    sandboxEnabled: config.sandboxEnabled ?? true,
    policyName: config.policyName || 'production',
    ...config,
  };

  // Assess trifecta risk
  const assessor = new TrifectaAssessor();
  const assessment = assessor.assess(fullConfig.trifecta);

  if (!assessment.acceptableForProduction && fullConfig.policyName === 'production') {
    console.warn('WARNING: Trifecta assessment indicates critical risk');
    console.warn('Mitigations needed:', assessment.mitigations);
  }

  // Create policy checker
  const policyChecker = new PolicyChecker(productionPolicy);

  // Create validator with all security layers
  const safety = createStrictSafety(policyChecker);
  const validator = new ActionValidator()
    .addValidator('safety', createSafetyValidator(safety));

  // Create sandbox if enabled
  let sandbox: FilesystemSandbox | undefined;
  if (fullConfig.sandboxEnabled) {
    sandbox = await createStrictSandbox('secure-agent');
  }

  return {
    config: fullConfig,
    sandbox,
    validator,
    policyChecker,
    auditLog: [],
  };
}

// =============================================================================
// Secure Input Processing
// =============================================================================

/**
 * Process input through security layers.
 *
 * Derivation (Input Sanitization):
 * "All untrusted input must be sanitized before processing.
 * This is the first line of defense against prompt injection."
 */
export function processSecureInput(
  input: string,
  context: SecureContext
): { processed: string; safe: boolean; audit: AuditEntry } {
  const result = sanitizeInput(input, context.config.sanitization);

  const audit: AuditEntry = {
    timestamp: Date.now(),
    type: 'input',
    action: 'sanitize',
    details: {
      originalLength: input.length,
      processedLength: result.sanitized.length,
      warnings: result.warnings,
      blocked: result.blocked,
    },
    blocked: !result.safe,
    reason: result.blocked.length > 0 ? result.blocked.join('; ') : undefined,
  };

  context.auditLog.push(audit);

  return {
    processed: result.sanitized,
    safe: result.safe,
    audit,
  };
}

// =============================================================================
// Secure Action Execution
// =============================================================================

/**
 * Execute an action through security layers.
 *
 * Derivation (Defense in Depth):
 * "Validate every action before execution.
 * Sandbox dangerous operations. Audit everything."
 */
export async function executeSecureAction(
  toolCall: { id: string; name: string; input: Record<string, unknown> },
  tool: Tool,
  context: SecureContext
): Promise<{ result: ToolResult; audit: AuditEntry }> {
  const startTime = Date.now();

  // 1. Validate action
  const validation = await context.validator.validate(toolCall, {
    custom: { policyContext: {} },
  });

  if (!validation.valid) {
    const audit: AuditEntry = {
      timestamp: Date.now(),
      type: 'action',
      action: toolCall.name,
      details: { input: toolCall.input, errors: validation.errors },
      blocked: true,
      reason: validation.errors.map(e => e.message).join('; '),
    };

    context.auditLog.push(audit);

    return {
      result: {
        toolUseId: toolCall.id,
        content: `Action blocked: ${audit.reason}`,
        isError: true,
      },
      audit,
    };
  }

  // 2. Execute (potentially in sandbox)
  let content: string;
  let isError = false;

  try {
    if (context.sandbox && requiresSandbox(toolCall.name)) {
      // Execute in sandbox
      content = await executeInSandboxWrapper(toolCall, context.sandbox);
    } else {
      // Direct execution
      content = await tool.execute(toolCall.input);
    }
  } catch (error) {
    content = `Error: ${error}`;
    isError = true;
  }

  // 3. Filter output
  if (context.config.filterOutput && !isError) {
    const filtered = filterSensitiveOutput(
      content,
      context.config.allowedOutputTypes
    );

    if (filtered.detections.length > 0) {
      console.warn('Sensitive data detected in output:', filtered.detections);
    }

    content = filtered.filtered;
  }

  const audit: AuditEntry = {
    timestamp: Date.now(),
    type: 'output',
    action: toolCall.name,
    details: {
      durationMs: Date.now() - startTime,
      outputLength: content.length,
      isError,
    },
    blocked: false,
  };

  context.auditLog.push(audit);

  return {
    result: {
      toolUseId: toolCall.id,
      content,
      isError,
    },
    audit,
  };
}

/**
 * Check if a tool requires sandbox execution.
 */
function requiresSandbox(toolName: string): boolean {
  const sandboxedTools = [
    'execute_command',
    'execute_code',
    'run_script',
    'shell',
  ];

  return sandboxedTools.some(t =>
    toolName.toLowerCase().includes(t.toLowerCase())
  );
}

/**
 * Execute a tool in the sandbox.
 */
async function executeInSandboxWrapper(
  toolCall: { name: string; input: Record<string, unknown> },
  sandbox: FilesystemSandbox
): Promise<string> {
  const command = String(toolCall.input.command || toolCall.input.code || '');

  // Validate command
  const validation = validateCommand(command);
  if (!validation.valid) {
    throw new Error(`Command blocked: ${validation.reason}`);
  }

  // Execute in sandbox
  const result = await sandbox.execute('/bin/sh', ['-c', command]);

  if (result.timedOut) {
    throw new Error('Execution timed out');
  }

  if (!result.success) {
    throw new Error(result.stderr || 'Execution failed');
  }

  return result.stdout || 'Completed with no output';
}

// =============================================================================
// Secure Agent Wrapper
// =============================================================================

/**
 * Wrap an agent with security layers.
 *
 * Derivation (Decorator Pattern):
 * "Security should be additive, not invasive.
 * Wrap existing agents to add security without modifying them."
 */
export function createSecureAgentWrapper(
  context: SecureContext
): {
  processInput: (input: string) => { processed: string; safe: boolean };
  executeAction: (
    toolCall: { id: string; name: string; input: Record<string, unknown> },
    tool: Tool
  ) => Promise<ToolResult>;
  getAuditLog: () => AuditEntry[];
  cleanup: () => Promise<void>;
} {
  return {
    processInput: (input: string) => {
      const result = processSecureInput(input, context);
      return { processed: result.processed, safe: result.safe };
    },

    executeAction: async (toolCall, tool) => {
      const result = await executeSecureAction(toolCall, tool, context);
      return result.result;
    },

    getAuditLog: () => [...context.auditLog],

    cleanup: async () => {
      if (context.sandbox) {
        await context.sandbox.cleanup();
      }
    },
  };
}

// =============================================================================
// Complete Secure Agent Example
// =============================================================================

/**
 * Example: Running an agent with full security stack.
 *
 * ```typescript
 * import { createSecureContext, createSecureAgentWrapper } from './secure-agent';
 * import { runAgent } from '../../01-the-loop/minimal-agent';
 * import { standardTools } from '../../02-tool-design/examples/basic-tools';
 *
 * async function runSecureAgent(task: string) {
 *   // Create secure context
 *   const context = await createSecureContext({
 *     policyName: 'production',
 *     sandboxEnabled: true,
 *     filterOutput: true,
 *   });
 *
 *   const secure = createSecureAgentWrapper(context);
 *
 *   try {
 *     // Sanitize user input
 *     const { processed, safe } = secure.processInput(task);
 *
 *     if (!safe) {
 *       console.warn('Input contained blocked patterns');
 *     }
 *
 *     // Run agent with secure tool execution
 *     const secureTools = standardTools.map(tool => ({
 *       ...tool,
 *       execute: async (input: any) => {
 *         const result = await secure.executeAction(
 *           { id: 'call-1', name: tool.definition.name, input },
 *           tool
 *         );
 *         if (result.isError) {
 *           throw new Error(result.content);
 *         }
 *         return result.content;
 *       },
 *     }));
 *
 *     const result = await runAgent(processed, secureTools);
 *
 *     // Log audit trail
 *     console.log('Audit log:', secure.getAuditLog());
 *
 *     return result;
 *   } finally {
 *     await secure.cleanup();
 *   }
 * }
 * ```
 */

// =============================================================================
// Security Monitoring
// =============================================================================

/**
 * Analyze audit log for security anomalies.
 */
export function analyzeAuditLog(
  log: AuditEntry[]
): {
  totalActions: number;
  blockedActions: number;
  securityIncidents: AuditEntry[];
  riskScore: number;
} {
  const blockedActions = log.filter(e => e.blocked).length;
  const securityIncidents = log.filter(
    e => e.type === 'security' || (e.blocked && e.reason?.includes('injection'))
  );

  // Calculate risk score (0-100)
  let riskScore = 0;

  // Each blocked action adds risk
  riskScore += Math.min(blockedActions * 5, 30);

  // Security incidents are high risk
  riskScore += Math.min(securityIncidents.length * 20, 50);

  // High action volume without blocks is suspicious
  if (log.length > 100 && blockedActions === 0) {
    riskScore += 10;
  }

  return {
    totalActions: log.length,
    blockedActions,
    securityIncidents,
    riskScore: Math.min(riskScore, 100),
  };
}

