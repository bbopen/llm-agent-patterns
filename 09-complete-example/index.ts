/**
 * index.ts - Complete Example Entry Point
 *
 * Derivation:
 * - This module brings together all principles from the guide
 * - It serves as both a working example and a reference implementation
 *
 * Exported components:
 * - Agent: The core agent implementation
 * - Config: Configuration management
 * - Tools: Tool implementations
 */

// =============================================================================
// Core Agent
// =============================================================================

export {
  Agent,
  createAgent,
  type LLMClient,
  type LLMResponse,
  type Message,
  type AgentResult,
} from './agent';

// =============================================================================
// Configuration
// =============================================================================

export {
  loadConfig,
  defaultConfig,
  ConfigPresets,
  isPathAllowed,
  containsBlockedPattern,
  requiresConfirmation,
  type AgentConfig,
  type BudgetConfig,
  type SafetyConfig,
  type OpsConfig,
  type ToolConfig,
  type ObservabilityConfig,
} from './config';

// =============================================================================
// Tools
// =============================================================================

export {
  createToolSet,
  createDoneTool,
  createThinkTool,
  createAskUserTool,
  createFileTools,
  createSearchTools,
  type ToolSet,
} from './tools';

// =============================================================================
// Re-exports from Guide Modules
// =============================================================================

// 01-the-loop
export { runAgent } from '../01-the-loop/minimal-agent';

// 02-tool-design
export { createTool } from '../02-tool-design/tool-types';
export type { Tool, ToolResult } from '../02-tool-design/tool-types';
export { doneTool, doneOrFailTool, TaskComplete, isTaskComplete, extractCompletion } from '../02-tool-design/done-tool';

// 03-validation
export { ActionValidator, createStandardValidator } from '../03-validation/validator';
export { PolicyChecker, buildPolicy, developmentPolicy, productionPolicy, readOnlyPolicy } from '../03-validation/policy';
export { SubsumptionSafety, createStandardSafety } from '../03-validation/examples/safety-layers';

// 04-state-memory
export { EventStore, projectState, type AgentEvent } from '../04-state-memory/event-store';
export { ContextManager, type CompressionStrategy } from '../04-state-memory/context-manager';

// 05-security
export { TrifectaAssessor, sanitizeInput } from '../05-security/trifecta';
export { FilesystemSandbox, executeInSandbox } from '../05-security/sandbox';

// 06-evaluation
export { Evaluator, compareEvaluations, generateReport } from '../06-evaluation/evaluator';
export { TraceCollector, analyzeTraces } from '../06-evaluation/trace';

// 07-ops
export { withRetry, RetryPolicies } from '../07-ops/retry';
export { CircuitBreaker, createCircuitBreaker, CircuitOpenError } from '../07-ops/circuit-breaker';
export { RateLimiter, createRateLimiter, RateLimitExceededError } from '../07-ops/rate-limiter';
export { ProductionOps, createProductionOps, ProductionConfigs } from '../07-ops/examples/production-agent';

// 08-orchestration
export { Coordinator, createCoordinator, aggregateResults } from '../08-orchestration/coordinator';
export { Worker, createWorker, WorkerPool, WorkerTemplates } from '../08-orchestration/sub-agent';

// =============================================================================
// Quick Start
// =============================================================================

/**
 * Quick start example.
 *
 * ```typescript
 * import { createAgent, createAnthropicClient } from './09-complete-example';
 *
 * // Create client (implement based on your API choice)
 * const client = createAnthropicClient(process.env.ANTHROPIC_API_KEY);
 *
 * // Create agent with defaults
 * const agent = createAgent(client);
 *
 * // Run a task
 * const result = await agent.run('Create a hello world program');
 *
 * console.log(result.success);  // true/false
 * console.log(result.result);   // Task result
 * console.log(result.metrics);  // { iterations, tokens, duration, toolCalls }
 * ```
 *
 * With custom configuration:
 *
 * ```typescript
 * import { createAgent, ConfigPresets } from './09-complete-example';
 *
 * // Use a preset
 * const agent = createAgent(client, ConfigPresets.production);
 *
 * // Or customize
 * const customAgent = createAgent(client, {
 *   budget: {
 *     maxIterations: 100,
 *     maxTokens: 50000,
 *     maxTime: 600000,
 *   },
 *   safety: {
 *     allowedPaths: ['/workspace', '/tmp'],
 *     sandboxMode: true,
 *   },
 *   tools: {
 *     fileTools: true,
 *     searchTools: true,
 *     executeTools: false,
 *   },
 * });
 * ```
 */

