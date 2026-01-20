/**
 * config.ts - Agent Configuration
 *
 * Derivation:
 * - Report 26: "All limits must be explicit and configurable"
 * - Netflix: "Configuration drives behavior, not code changes"
 * - 12-Factor: "Store config in the environment"
 *
 * Configuration is the contract between the agent and its operators.
 * Every limit, every policy, every behavior should be configurable.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Complete agent configuration.
 */
export interface AgentConfig {
  /** Budget and resource limits */
  budget: BudgetConfig;

  /** Safety and security policies */
  safety: SafetyConfig;

  /** Operations configuration */
  ops: OpsConfig;

  /** Tool configuration */
  tools: ToolConfig;

  /** Logging and observability */
  observability: ObservabilityConfig;
}

/**
 * Budget configuration.
 */
export interface BudgetConfig {
  /** Maximum tokens per session */
  maxTokens: number;

  /** Maximum iterations (agent loop turns) */
  maxIterations: number;

  /** Maximum time in milliseconds */
  maxTime: number;

  /** Maximum tool calls per iteration */
  maxToolCallsPerIteration: number;

  /** Token buffer to reserve for response */
  tokenBuffer: number;
}

/**
 * Safety configuration.
 */
export interface SafetyConfig {
  /** Allowed filesystem paths */
  allowedPaths: string[];

  /** Blocked command patterns */
  blockedPatterns: string[];

  /** Tools requiring confirmation */
  requireConfirmation: string[];

  /** Maximum file size for read/write (bytes) */
  maxFileSize: number;

  /** Enable sandbox mode */
  sandboxMode: boolean;

  /** Enable audit logging */
  auditLogging: boolean;
}

/**
 * Operations configuration.
 */
export interface OpsConfig {
  /** Retry configuration */
  retry: {
    enabled: boolean;
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
  };

  /** Circuit breaker configuration */
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeout: number;
  };

  /** Rate limiting configuration */
  rateLimiter: {
    enabled: boolean;
    requestsPerMinute: number;
    burstSize: number;
  };

  /** Health check configuration */
  healthCheck: {
    enabled: boolean;
    intervalMs: number;
  };
}

/**
 * Tool configuration.
 */
export interface ToolConfig {
  /** Enable file tools */
  fileTools: boolean;

  /** Enable search tools */
  searchTools: boolean;

  /** Enable execute tools (shell commands) */
  executeTools: boolean;

  /** Custom tool timeout (ms) */
  toolTimeout: number;
}

/**
 * Observability configuration.
 */
export interface ObservabilityConfig {
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Enable metrics collection */
  metricsEnabled: boolean;

  /** Enable distributed tracing */
  tracingEnabled: boolean;

  /** Log file path (optional) */
  logFile?: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration values.
 *
 * Derivation (Secure Defaults):
 * "Defaults should be safe. Users opt into danger, not out of safety."
 */
export const defaultConfig: AgentConfig = {
  budget: {
    maxTokens: 100000,
    maxIterations: 50,
    maxTime: 300000, // 5 minutes
    maxToolCallsPerIteration: 10,
    tokenBuffer: 4000,
  },

  safety: {
    allowedPaths: [process.cwd()], // Only current directory by default
    blockedPatterns: [
      'rm -rf /',
      'rm -rf ~',
      'sudo',
      '> /dev/',
      'chmod 777',
      'curl | sh',
      'wget | sh',
      'eval(',
    ],
    requireConfirmation: [], // No confirmation required by default
    maxFileSize: 10 * 1024 * 1024, // 10MB
    sandboxMode: true,
    auditLogging: true,
  },

  ops: {
    retry: {
      enabled: true,
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      resetTimeout: 60000,
    },
    rateLimiter: {
      enabled: true,
      requestsPerMinute: 60,
      burstSize: 10,
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
    },
  },

  tools: {
    fileTools: true,
    searchTools: true,
    executeTools: false, // Disabled by default for safety
    toolTimeout: 30000,
  },

  observability: {
    logLevel: 'info',
    metricsEnabled: true,
    tracingEnabled: false,
  },
};

// =============================================================================
// Configuration Presets
// =============================================================================

/**
 * Pre-configured configurations for common scenarios.
 */
export const ConfigPresets = {
  /**
   * Development: Relaxed limits, verbose logging.
   */
  development: {
    ...defaultConfig,
    budget: {
      ...defaultConfig.budget,
      maxIterations: 100,
      maxTime: 600000, // 10 minutes
    },
    safety: {
      ...defaultConfig.safety,
      sandboxMode: false,
      blockedPatterns: ['rm -rf /', 'rm -rf ~'], // Minimal blocking
    },
    ops: {
      ...defaultConfig.ops,
      retry: { ...defaultConfig.ops.retry, enabled: false },
      circuitBreaker: { ...defaultConfig.ops.circuitBreaker, enabled: false },
      rateLimiter: { ...defaultConfig.ops.rateLimiter, enabled: false },
    },
    tools: {
      ...defaultConfig.tools,
      executeTools: true,
    },
    observability: {
      ...defaultConfig.observability,
      logLevel: 'debug' as const,
    },
  } as AgentConfig,

  /**
   * Production: Strict limits, full ops stack.
   */
  production: {
    ...defaultConfig,
    budget: {
      ...defaultConfig.budget,
      maxTokens: 50000, // Lower budget in production
      maxIterations: 30,
    },
    safety: {
      ...defaultConfig.safety,
      sandboxMode: true,
      auditLogging: true,
    },
    ops: {
      ...defaultConfig.ops,
      retry: { ...defaultConfig.ops.retry, maxAttempts: 5 },
      healthCheck: { ...defaultConfig.ops.healthCheck, intervalMs: 10000 },
    },
    observability: {
      ...defaultConfig.observability,
      logLevel: 'info' as const,
      metricsEnabled: true,
      tracingEnabled: true,
    },
  } as AgentConfig,

  /**
   * Restricted: Maximum safety, minimal capabilities.
   */
  restricted: {
    ...defaultConfig,
    budget: {
      ...defaultConfig.budget,
      maxTokens: 20000,
      maxIterations: 10,
      maxTime: 60000, // 1 minute
    },
    safety: {
      ...defaultConfig.safety,
      allowedPaths: [], // No file access
      requireConfirmation: ['read_file', 'write_file', 'search'],
      sandboxMode: true,
    },
    tools: {
      ...defaultConfig.tools,
      fileTools: false,
      executeTools: false,
    },
  } as AgentConfig,

  /**
   * Autonomous: Higher limits for unsupervised operation.
   */
  autonomous: {
    ...defaultConfig,
    budget: {
      ...defaultConfig.budget,
      maxTokens: 200000,
      maxIterations: 100,
      maxTime: 900000, // 15 minutes
    },
    ops: {
      ...defaultConfig.ops,
      retry: { ...defaultConfig.ops.retry, maxAttempts: 5 },
      circuitBreaker: {
        ...defaultConfig.ops.circuitBreaker,
        failureThreshold: 10,
      },
    },
    observability: {
      ...defaultConfig.observability,
      metricsEnabled: true,
      tracingEnabled: true,
    },
  } as AgentConfig,
};

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load configuration from environment and file.
 */
export function loadConfig(
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  // Start with defaults
  let config = { ...defaultConfig };

  // Apply environment-based preset
  const preset = process.env.AGENT_PRESET;
  if (preset && preset in ConfigPresets) {
    config = ConfigPresets[preset as keyof typeof ConfigPresets];
  }

  // Apply environment variable overrides
  config = applyEnvOverrides(config);

  // Apply explicit overrides
  config = mergeConfig(config, overrides);

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Apply environment variable overrides.
 */
function applyEnvOverrides(config: AgentConfig): AgentConfig {
  const env = process.env;

  return {
    ...config,
    budget: {
      ...config.budget,
      maxTokens: env.AGENT_MAX_TOKENS
        ? parseInt(env.AGENT_MAX_TOKENS, 10)
        : config.budget.maxTokens,
      maxIterations: env.AGENT_MAX_ITERATIONS
        ? parseInt(env.AGENT_MAX_ITERATIONS, 10)
        : config.budget.maxIterations,
      maxTime: env.AGENT_MAX_TIME
        ? parseInt(env.AGENT_MAX_TIME, 10)
        : config.budget.maxTime,
    },
    safety: {
      ...config.safety,
      sandboxMode: env.AGENT_SANDBOX_MODE
        ? env.AGENT_SANDBOX_MODE === 'true'
        : config.safety.sandboxMode,
    },
    observability: {
      ...config.observability,
      logLevel: (env.AGENT_LOG_LEVEL as ObservabilityConfig['logLevel']) ||
        config.observability.logLevel,
    },
  };
}

/**
 * Deep merge configuration objects.
 */
function mergeConfig(
  base: AgentConfig,
  overrides: Partial<AgentConfig>
): AgentConfig {
  return {
    budget: { ...base.budget, ...overrides.budget },
    safety: { ...base.safety, ...overrides.safety },
    ops: {
      ...base.ops,
      ...overrides.ops,
      retry: { ...base.ops.retry, ...overrides.ops?.retry },
      circuitBreaker: {
        ...base.ops.circuitBreaker,
        ...overrides.ops?.circuitBreaker,
      },
      rateLimiter: { ...base.ops.rateLimiter, ...overrides.ops?.rateLimiter },
      healthCheck: { ...base.ops.healthCheck, ...overrides.ops?.healthCheck },
    },
    tools: { ...base.tools, ...overrides.tools },
    observability: { ...base.observability, ...overrides.observability },
  };
}

/**
 * Validate configuration.
 */
function validateConfig(config: AgentConfig): void {
  // Budget validation
  if (config.budget.maxTokens <= 0) {
    throw new Error('maxTokens must be positive');
  }
  if (config.budget.maxIterations <= 0) {
    throw new Error('maxIterations must be positive');
  }
  if (config.budget.maxTime <= 0) {
    throw new Error('maxTime must be positive');
  }

  // Safety validation
  if (config.safety.maxFileSize <= 0) {
    throw new Error('maxFileSize must be positive');
  }

  // Ops validation
  if (config.ops.retry.maxAttempts < 1) {
    throw new Error('retry.maxAttempts must be at least 1');
  }
  if (config.ops.rateLimiter.requestsPerMinute <= 0) {
    throw new Error('rateLimiter.requestsPerMinute must be positive');
  }
}

// =============================================================================
// Configuration Utilities
// =============================================================================

/**
 * Check if a path is allowed.
 */
export function isPathAllowed(path: string, config: AgentConfig): boolean {
  const normalizedPath = path.startsWith('/')
    ? path
    : `${process.cwd()}/${path}`;

  return config.safety.allowedPaths.some(allowed =>
    normalizedPath.startsWith(allowed)
  );
}

/**
 * Check if a command contains blocked patterns.
 */
export function containsBlockedPattern(
  command: string,
  config: AgentConfig
): string | null {
  for (const pattern of config.safety.blockedPatterns) {
    if (command.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if a tool requires confirmation.
 */
export function requiresConfirmation(
  toolName: string,
  config: AgentConfig
): boolean {
  return config.safety.requireConfirmation.includes(toolName);
}

