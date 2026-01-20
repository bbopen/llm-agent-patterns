/**
 * trifecta.ts - Lethal Trifecta Assessment and Mitigation
 *
 * Derivation:
 * - Willison: "Prompt injection is architectural, not just a bug"
 * - Schneier: "Defense in depth requires multiple independent barriers"
 * - Report 26: "Isolation provides the missing security layer"
 *
 * The Lethal Trifecta: Private Data + Untrusted Input + External Actions
 * When all three combine, the system is fundamentally vulnerable.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Types of private data the agent can access.
 */
export type PrivateDataType =
  | 'database'      // Database access
  | 'filesystem'    // File system access
  | 'secrets'       // API keys, passwords
  | 'internal_api'  // Internal service access
  | 'user_data'     // Personal user information
  | 'financial'     // Financial records
  | 'health'        // Health/medical data
  | 'credentials';  // Authentication credentials

/**
 * Sources of untrusted input.
 */
export type UntrustedInputSource =
  | 'user_direct'   // Direct user input
  | 'user_file'     // User-uploaded files
  | 'web_scrape'    // Web page content
  | 'email'         // Email content
  | 'api_response'  // External API responses
  | 'webhook'       // Incoming webhooks
  | 'chat';         // Chat/messaging content

/**
 * Types of external actions.
 */
export type ExternalActionType =
  | 'execute_code'  // Code/command execution
  | 'network_call'  // HTTP/network requests
  | 'file_write'    // Writing to filesystem
  | 'file_delete'   // Deleting files
  | 'database_write'// Database modifications
  | 'send_email'    // Sending emails
  | 'create_user'   // User management
  | 'payment';      // Financial transactions

/**
 * Sensitivity level for data.
 */
export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Risk level for trifecta assessment.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Private data assessment.
 */
export interface PrivateDataAssessment {
  present: boolean;
  types: PrivateDataType[];
  sensitivity: SensitivityLevel;
  encrypted: boolean;
  accessControlled: boolean;
}

/**
 * Untrusted input assessment.
 */
export interface UntrustedInputAssessment {
  present: boolean;
  sources: UntrustedInputSource[];
  sanitized: boolean;
  validated: boolean;
  truncated: boolean;
}

/**
 * External actions assessment.
 */
export interface ExternalActionsAssessment {
  present: boolean;
  types: ExternalActionType[];
  reversible: boolean;
  confirmed: boolean;
  audited: boolean;
}

/**
 * Complete trifecta assessment.
 */
export interface TrifectaAssessment {
  privateData: PrivateDataAssessment;
  untrustedInput: UntrustedInputAssessment;
  externalActions: ExternalActionsAssessment;
}

/**
 * Mitigation recommendation.
 */
export interface Mitigation {
  type: 'required' | 'recommended' | 'optional';
  category: 'input' | 'data' | 'action' | 'isolation';
  description: string;
  implementation: string;
}

/**
 * Risk assessment result.
 */
export interface RiskAssessment {
  risk: RiskLevel;
  trifectaComplete: boolean;
  vulnerabilities: string[];
  mitigations: Mitigation[];
  acceptableForProduction: boolean;
}

// =============================================================================
// Trifecta Assessor
// =============================================================================

/**
 * Assesses the Lethal Trifecta risk for an agent configuration.
 *
 * Derivation (Willison):
 * "Any system that combines untrusted input with privileged actions
 * is inherently vulnerable. The question is not if, but when."
 */
export class TrifectaAssessor {
  /**
   * Perform a full risk assessment.
   */
  assess(config: TrifectaAssessment): RiskAssessment {
    const vulnerabilities: string[] = [];
    const mitigations: Mitigation[] = [];

    // Check if trifecta is complete
    const trifectaComplete =
      config.privateData.present &&
      config.untrustedInput.present &&
      config.externalActions.present;

    // Assess private data risks
    if (config.privateData.present) {
      this.assessPrivateData(config.privateData, vulnerabilities, mitigations);
    }

    // Assess untrusted input risks
    if (config.untrustedInput.present) {
      this.assessUntrustedInput(config.untrustedInput, vulnerabilities, mitigations);
    }

    // Assess external action risks
    if (config.externalActions.present) {
      this.assessExternalActions(config.externalActions, vulnerabilities, mitigations);
    }

    // Assess combination risks
    if (trifectaComplete) {
      this.assessTrifectaCombination(config, vulnerabilities, mitigations);
    }

    // Calculate overall risk
    const risk = this.calculateRisk(
      trifectaComplete,
      config,
      vulnerabilities
    );

    return {
      risk,
      trifectaComplete,
      vulnerabilities,
      mitigations,
      acceptableForProduction: risk !== 'critical' && vulnerabilities.length === 0,
    };
  }

  /**
   * Assess private data risks.
   */
  private assessPrivateData(
    data: PrivateDataAssessment,
    vulnerabilities: string[],
    mitigations: Mitigation[]
  ): void {
    // Check for high-sensitivity data without encryption
    if (data.sensitivity === 'critical' && !data.encrypted) {
      vulnerabilities.push('Critical data stored without encryption');
      mitigations.push({
        type: 'required',
        category: 'data',
        description: 'Encrypt critical data at rest',
        implementation: 'Use AES-256 encryption for sensitive data storage',
      });
    }

    // Check for access control
    if (!data.accessControlled) {
      vulnerabilities.push('Private data lacks access control');
      mitigations.push({
        type: 'required',
        category: 'data',
        description: 'Implement access control for private data',
        implementation: 'Add role-based access control (RBAC) to data access layer',
      });
    }

    // Special handling for credentials
    if (data.types.includes('credentials') || data.types.includes('secrets')) {
      mitigations.push({
        type: 'required',
        category: 'data',
        description: 'Use secret management system',
        implementation: 'Store secrets in vault (HashiCorp, AWS Secrets Manager)',
      });
    }
  }

  /**
   * Assess untrusted input risks.
   */
  private assessUntrustedInput(
    input: UntrustedInputAssessment,
    vulnerabilities: string[],
    mitigations: Mitigation[]
  ): void {
    // Check for unsanitized input
    if (!input.sanitized) {
      vulnerabilities.push('Untrusted input is not sanitized');
      mitigations.push({
        type: 'required',
        category: 'input',
        description: 'Sanitize all untrusted input',
        implementation: 'Use sanitizeInput() before processing any external content',
      });
    }

    // Check for unvalidated input
    if (!input.validated) {
      vulnerabilities.push('Untrusted input is not validated');
      mitigations.push({
        type: 'required',
        category: 'input',
        description: 'Validate input format and content',
        implementation: 'Use schema validation (Zod) for all external input',
      });
    }

    // Check for unbounded input
    if (!input.truncated) {
      mitigations.push({
        type: 'recommended',
        category: 'input',
        description: 'Truncate long inputs',
        implementation: 'Limit input length to prevent context stuffing attacks',
      });
    }

    // High-risk sources
    const highRiskSources: UntrustedInputSource[] = ['web_scrape', 'email', 'webhook'];
    const hasHighRisk = input.sources.some(s => highRiskSources.includes(s));

    if (hasHighRisk) {
      mitigations.push({
        type: 'required',
        category: 'input',
        description: 'Extra sanitization for high-risk sources',
        implementation: 'Apply aggressive sanitization for web/email/webhook content',
      });
    }
  }

  /**
   * Assess external action risks.
   */
  private assessExternalActions(
    actions: ExternalActionsAssessment,
    vulnerabilities: string[],
    mitigations: Mitigation[]
  ): void {
    // Check for irreversible actions without confirmation
    if (!actions.reversible && !actions.confirmed) {
      vulnerabilities.push('Irreversible actions lack confirmation');
      mitigations.push({
        type: 'required',
        category: 'action',
        description: 'Require confirmation for irreversible actions',
        implementation: 'Add user confirmation step before destructive operations',
      });
    }

    // Check for unaudited actions
    if (!actions.audited) {
      mitigations.push({
        type: 'required',
        category: 'action',
        description: 'Audit all external actions',
        implementation: 'Log all tool calls with user context and timestamps',
      });
    }

    // High-risk action types
    const highRiskActions: ExternalActionType[] = [
      'execute_code',
      'file_delete',
      'payment',
      'create_user',
    ];
    const hasHighRisk = actions.types.some(t => highRiskActions.includes(t));

    if (hasHighRisk) {
      mitigations.push({
        type: 'required',
        category: 'action',
        description: 'Sandbox high-risk actions',
        implementation: 'Execute dangerous operations in isolated sandbox',
      });
    }
  }

  /**
   * Assess risks from the complete trifecta combination.
   */
  private assessTrifectaCombination(
    config: TrifectaAssessment,
    vulnerabilities: string[],
    mitigations: Mitigation[]
  ): void {
    vulnerabilities.push(
      'LETHAL TRIFECTA: Private data + Untrusted input + External actions'
    );

    mitigations.push({
      type: 'required',
      category: 'isolation',
      description: 'Implement capability isolation',
      implementation: 'Separate read-only and action agents; filter data between them',
    });

    // If high-sensitivity data with direct user input and execution
    if (
      config.privateData.sensitivity === 'critical' &&
      config.untrustedInput.sources.includes('user_direct') &&
      config.externalActions.types.includes('execute_code')
    ) {
      mitigations.push({
        type: 'required',
        category: 'isolation',
        description: 'Use VM-level isolation for maximum security',
        implementation: 'Run agent in isolated VM with no access to host system',
      });
    }
  }

  /**
   * Calculate overall risk level.
   */
  private calculateRisk(
    trifectaComplete: boolean,
    config: TrifectaAssessment,
    vulnerabilities: string[]
  ): RiskLevel {
    // Critical: Complete trifecta with vulnerabilities
    if (trifectaComplete && vulnerabilities.length > 0) {
      return 'critical';
    }

    // High: Complete trifecta (even mitigated, still risky)
    if (trifectaComplete) {
      return 'high';
    }

    // High: Critical data without protection
    if (
      config.privateData.present &&
      config.privateData.sensitivity === 'critical' &&
      !config.privateData.encrypted
    ) {
      return 'high';
    }

    // Medium: Two of three trifecta elements
    const elementCount = [
      config.privateData.present,
      config.untrustedInput.present,
      config.externalActions.present,
    ].filter(Boolean).length;

    if (elementCount === 2) {
      return 'medium';
    }

    // Low: Single element or none
    return 'low';
  }
}

// =============================================================================
// Input Sanitization
// =============================================================================

/**
 * Known prompt injection patterns.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction overrides
  /ignore (previous|all|above|prior) instructions?/i,
  /disregard (everything|all|previous)/i,
  /forget (everything|your instructions)/i,

  // Role manipulation
  /you are now/i,
  /act as (if you were|a)/i,
  /pretend (to be|you're)/i,
  /your new (role|purpose|instructions)/i,

  // System prompt extraction
  /what (is|are) your (instructions|system prompt|rules)/i,
  /repeat (your|the) (instructions|prompt|rules)/i,
  /show me (your|the) system/i,

  // Delimiter attacks
  /\[system\]/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /###\s*(system|instruction)/i,

  // Jailbreak attempts
  /DAN\s*mode/i,
  /developer mode/i,
  /no (ethical|safety) guidelines/i,
];

/**
 * Sanitization configuration.
 */
export interface SanitizationConfig {
  maxLength: number;
  removeInvisible: boolean;
  removePatterns: boolean;
  patterns?: RegExp[];
}

/**
 * Sanitization result.
 */
export interface SanitizationResult {
  safe: boolean;
  sanitized: string;
  warnings: string[];
  blocked: string[];
}

/**
 * Sanitize untrusted input.
 *
 * Derivation (Defense in Depth):
 * "Input sanitization is the first barrier.
 * It won't catch everything, but it catches the obvious."
 */
export function sanitizeInput(
  input: string,
  config: SanitizationConfig = {
    maxLength: 10000,
    removeInvisible: true,
    removePatterns: true,
  }
): SanitizationResult {
  const warnings: string[] = [];
  const blocked: string[] = [];
  let sanitized = input;

  // Remove injection patterns
  if (config.removePatterns) {
    const patterns = config.patterns || INJECTION_PATTERNS;
    for (const pattern of patterns) {
      if (pattern.test(sanitized)) {
        blocked.push(`Injection pattern: ${pattern.source.substring(0, 50)}`);
        sanitized = sanitized.replace(pattern, '[BLOCKED]');
      }
    }
  }

  // Remove invisible characters
  if (config.removeInvisible) {
    const original = sanitized;
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
    if (sanitized !== original) {
      warnings.push('Removed invisible characters');
    }
  }

  // Truncate excessive length
  if (sanitized.length > config.maxLength) {
    warnings.push(`Truncated from ${input.length} to ${config.maxLength} chars`);
    sanitized = sanitized.substring(0, config.maxLength);
  }

  return {
    safe: blocked.length === 0,
    sanitized,
    warnings,
    blocked,
  };
}

// =============================================================================
// Output Filtering
// =============================================================================

/**
 * Patterns that indicate sensitive data in outputs.
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, type: 'email' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, type: 'phone' },
  { pattern: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/, type: 'ssn' },
  { pattern: /\b4[0-9]{12}(?:[0-9]{3})?\b/, type: 'credit_card_visa' },
  { pattern: /\b5[1-5][0-9]{14}\b/, type: 'credit_card_mc' },
  { pattern: /\b[A-Za-z0-9]{20,}\b/, type: 'potential_api_key' },
  { pattern: /password\s*[:=]\s*\S+/i, type: 'password' },
  { pattern: /api[_-]?key\s*[:=]\s*\S+/i, type: 'api_key' },
  { pattern: /secret\s*[:=]\s*\S+/i, type: 'secret' },
  { pattern: /token\s*[:=]\s*\S+/i, type: 'token' },
];

/**
 * Filter sensitive data from outputs.
 */
export function filterSensitiveOutput(
  output: string,
  allowedTypes?: string[]
): { filtered: string; detections: { type: string; count: number }[] } {
  let filtered = output;
  const detections: { type: string; count: number }[] = [];

  for (const { pattern, type } of SENSITIVE_PATTERNS) {
    if (allowedTypes?.includes(type)) continue;

    const matches = filtered.match(new RegExp(pattern, 'g'));
    if (matches && matches.length > 0) {
      detections.push({ type, count: matches.length });
      filtered = filtered.replace(new RegExp(pattern, 'g'), `[REDACTED:${type}]`);
    }
  }

  return { filtered, detections };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a trifecta assessor instance.
 */
export function createTrifectaAssessor(): TrifectaAssessor {
  return new TrifectaAssessor();
}

/**
 * Quick trifecta check for common configurations.
 */
export function quickTrifectaCheck(config: {
  hasDatabase?: boolean;
  hasUserInput?: boolean;
  hasCodeExecution?: boolean;
  hasSensitiveData?: boolean;
}): RiskAssessment {
  const assessor = new TrifectaAssessor();

  return assessor.assess({
    privateData: {
      present: config.hasDatabase || config.hasSensitiveData || false,
      types: config.hasDatabase ? ['database'] : [],
      sensitivity: config.hasSensitiveData ? 'high' : 'low',
      encrypted: false,
      accessControlled: false,
    },
    untrustedInput: {
      present: config.hasUserInput || false,
      sources: config.hasUserInput ? ['user_direct'] : [],
      sanitized: false,
      validated: false,
      truncated: false,
    },
    externalActions: {
      present: config.hasCodeExecution || false,
      types: config.hasCodeExecution ? ['execute_code'] : [],
      reversible: false,
      confirmed: false,
      audited: false,
    },
  });
}

