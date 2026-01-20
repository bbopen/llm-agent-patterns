/**
 * agent.ts - Production Agent Implementation
 *
 * Derivation:
 * - Wiener (1948): "The agent IS its loop"
 * - Report 26: "Deterministic guards around stochastic core"
 * - Report 27: "Explicit termination via done tool"
 * - Report 28: "State is derived from events"
 *
 * This is the complete agent implementation bringing together:
 * - The agent loop (01-the-loop)
 * - Tool execution (02-tool-design)
 * - Validation (03-validation)
 * - State management (04-state-memory)
 * - Security (05-security)
 * - Operations (07-ops)
 */

import { Tool } from '../02-tool-design/tool-types';
import { SubsumptionSafety, createStandardSafety, SafetyContext } from '../03-validation/examples/safety-layers';
import { TrifectaAssessor } from '../05-security/trifecta';
import { ProductionOps, createProductionOps } from '../07-ops/examples/production-agent';
import { AgentConfig, loadConfig } from './config';
import { createToolSet, ToolSet } from './tools';
import { SimpleAgentEvent, InternalToolResult } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * LLM client interface.
 */
export interface LLMClient {
  chat(params: {
    model: string;
    messages: Message[];
    tools?: LLMTool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

/**
 * Message in the conversation.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool definition for LLM.
 */
export interface LLMTool {
  name: string;
  description: string;
  input_schema: unknown;
}

/**
 * LLM response.
 */
export interface LLMResponse {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
    id?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
}

/**
 * Agent execution result.
 */
export interface AgentResult {
  /** Final result from the agent */
  result: string;

  /** Whether execution completed successfully */
  success: boolean;

  /** Execution metrics */
  metrics: {
    iterations: number;
    tokensUsed: number;
    durationMs: number;
    toolCalls: number;
  };

  /** Event log */
  events: SimpleAgentEvent[];

  /** Any errors encountered */
  errors?: string[];
}

// =============================================================================
// Agent Implementation
// =============================================================================

/**
 * Production-ready agent.
 *
 * Derivation (The Loop):
 * "while (canContinue()) {
 *   response = queryLLM()
 *   validated = validate(response)
 *   results = executeTools(validated)
 *   updateState(results)
 * }"
 */
/**
 * Simple in-memory event store for section 09.
 * This is simpler than the formal EventStore in section 04.
 */
class SimpleEventStore {
  private events: SimpleAgentEvent[] = [];

  append(event: SimpleAgentEvent): void {
    this.events.push(event);
  }

  getEvents(): SimpleAgentEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export class Agent {
  private client: LLMClient;
  private config: AgentConfig;
  private tools: ToolSet;
  private ops: ProductionOps;
  private safety: SubsumptionSafety;
  private trifecta: TrifectaAssessor;
  private eventStore: SimpleEventStore;

  // State
  private messages: Message[] = [];
  private completed = false;
  private finalResult = '';
  private iterations = 0;
  private tokensUsed = 0;
  private toolCallCount = 0;
  private startTime = 0;
  private errors: string[] = [];

  constructor(
    client: LLMClient,
    config: Partial<AgentConfig> = {}
  ) {
    this.client = client;
    this.config = loadConfig(config);

    // Initialize tools
    this.tools = createToolSet(
      this.config,
      (result) => {
        this.completed = true;
        this.finalResult = result;
      }
    );

    // Initialize ops
    this.ops = createProductionOps({
      retry: this.config.ops.retry,
      circuitBreaker: this.config.ops.circuitBreaker,
      rateLimiter: {
        enabled: this.config.ops.rateLimiter.enabled,
        maxTokens: this.config.ops.rateLimiter.burstSize,
        refillRate: this.config.ops.rateLimiter.requestsPerMinute / 60,
      },
      healthCheck: this.config.ops.healthCheck,
      observability: this.config.observability,
    });

    // Initialize safety
    this.safety = createStandardSafety();
    this.trifecta = new TrifectaAssessor();

    // Initialize state management
    this.eventStore = new SimpleEventStore();
  }

  /**
   * Run the agent on a task.
   *
   * This is THE LOOP. Everything else is configuration.
   */
  async run(task: string): Promise<AgentResult> {
    this.reset();
    this.startTime = Date.now();

    // Record task start
    this.recordEvent({
      type: 'decision',
      decision: 'start_task',
      reasoning: task,
      timestamp: Date.now(),
    });

    // Initialize messages
    this.messages = [
      { role: 'system', content: this.getSystemPrompt() },
      { role: 'user', content: task },
    ];

    try {
      // THE LOOP
      while (this.canContinue()) {
        await this.iterate();
      }

      // Record completion
      this.recordEvent({
        type: 'decision',
        decision: 'complete_task',
        reasoning: this.completed
          ? `Completed: ${this.finalResult}`
          : 'Stopped: resource limits',
        timestamp: Date.now(),
      });

      return this.getResult();
    } catch (error) {
      this.errors.push(String(error));
      this.recordEvent({
        type: 'error',
        message: String(error),
        context: { phase: 'main_loop' },
        timestamp: Date.now(),
      });
      return this.getResult();
    } finally {
      this.ops.shutdown();
    }
  }

  /**
   * Single iteration of the agent loop.
   */
  private async iterate(): Promise<void> {
    this.iterations++;

    // Check safety before LLM call
    const safetyCheck = await this.checkSafety();
    if (!safetyCheck.allowed) {
      this.errors.push(`Safety check failed: ${safetyCheck.reason}`);
      this.completed = true;
      return;
    }

    // Query LLM with ops protection
    const response = await this.ops.callLlm(async () => {
      return this.client.chat({
        model: 'claude-sonnet-4-20250514',
        messages: this.messages,
        tools: this.tools.all.map(t => this.toolToLLMTool(t)),
        maxTokens: this.config.budget.maxTokens - this.tokensUsed,
      });
    });

    // Track token usage
    if (response.usage) {
      const tokens = response.usage.input_tokens + response.usage.output_tokens;
      this.tokensUsed += tokens;
      this.ops.recordTokens(tokens);
    }

    // Process response
    await this.processResponse(response);
  }

  /**
   * Process LLM response.
   */
  private async processResponse(response: LLMResponse): Promise<void> {
    // Extract text and tool calls
    const textBlocks = response.content.filter(b => b.type === 'text');
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    // Add assistant message
    const assistantContent = textBlocks.map(b => b.text).join('\n');
    if (assistantContent) {
      this.messages.push({ role: 'assistant', content: assistantContent });
    }

    // Execute tool calls
    if (toolBlocks.length > 0) {
      for (const block of toolBlocks) {
        if (block.name && block.input) {
          await this.executeToolCall(block.name, block.input, block.id);
        }
      }
    }

    // Check for end_turn without tool calls = natural completion
    if (toolBlocks.length === 0 && response.stop_reason === 'end_turn') {
      // Agent stopped without calling done - may need prompting
      // Don't auto-complete; let the loop decide
    }
  }

  /**
   * Execute a tool call with validation.
   */
  private async executeToolCall(
    name: string,
    input: Record<string, unknown>,
    id?: string
  ): Promise<void> {
    this.toolCallCount++;

    // Record tool call
    this.recordEvent({
      type: 'tool_call',
      tool: name,
      input,
      timestamp: Date.now(),
    });

    // Find tool
    const tool = this.tools.byName.get(name);
    if (!tool) {
      const errorResult: InternalToolResult = { success: false, error: `Tool not found: ${name}` };
      this.addToolResult(name, errorResult, id);
      return;
    }

    // Validate action through safety layers
    // SubsumptionSafety.check() expects a ToolCall with id, name, input
    const safetyContext: SafetyContext = {};
    const safetyResult = await this.safety.check(
      { id: id || 'unknown', name, input },
      safetyContext
    );

    if (!safetyResult.safe) {
      const blockedViolation = safetyResult.violations.find(v => v.block);
      const result: InternalToolResult = {
        success: false,
        error: `Blocked by safety: ${blockedViolation?.reason || 'Unknown safety violation'}`,
      };
      this.recordEvent({
        type: 'tool_result',
        tool: name,
        result,
        timestamp: Date.now(),
      });
      this.addToolResult(name, result, id);
      return;
    }

    // Execute tool with ops protection
    try {
      // Tool.execute returns Promise<string>
      const output = await this.ops.callTool(name, async () => {
        return tool.execute(input);
      });

      // Convert string output to InternalToolResult
      const result: InternalToolResult = {
        success: true,
        output: output as string,
      };

      // Check for done tool (name === 'done' indicates terminal action)
      if (name === 'done') {
        result.terminal = true;
        result.metadata = { terminal: true };
      }

      this.recordEvent({
        type: 'tool_result',
        tool: name,
        result,
        timestamp: Date.now(),
      });

      this.addToolResult(name, result, id);

      // Check for terminal action (done tool)
      if (result.terminal) {
        this.completed = true;
      }
    } catch (error) {
      const result: InternalToolResult = { success: false, error: String(error) };
      this.recordEvent({
        type: 'tool_result',
        tool: name,
        result,
        timestamp: Date.now(),
      });
      this.addToolResult(name, result, id);
    }
  }

  /**
   * Add tool result to messages.
   */
  private addToolResult(
    name: string,
    result: InternalToolResult,
    _id?: string
  ): void {
    const content = result.success
      ? result.output || 'Success'
      : `Error: ${result.error}`;

    // Add as user message (tool results come from environment)
    this.messages.push({
      role: 'user',
      content: `Tool ${name} result: ${content}`,
    });

    // Manage context if approaching limits
    if (this.tokensUsed > this.config.budget.maxTokens * 0.8) {
      this.compressContext();
    }
  }

  /**
   * Compress context to fit within limits.
   * Simple truncation strategy - keeps system prompt and recent messages.
   */
  private compressContext(): void {
    // Keep system prompt (first message) and last 10 messages
    if (this.messages.length > 11) {
      const systemMessage = this.messages[0];
      const recentMessages = this.messages.slice(-10);
      this.messages = [systemMessage, ...recentMessages];
    }
  }

  /**
   * Check if agent can continue.
   */
  private canContinue(): boolean {
    // Explicit completion
    if (this.completed) return false;

    // Iteration limit
    if (this.iterations >= this.config.budget.maxIterations) {
      this.errors.push('Reached maximum iterations');
      return false;
    }

    // Token limit
    if (this.tokensUsed >= this.config.budget.maxTokens) {
      this.errors.push('Reached token limit');
      return false;
    }

    // Time limit
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.config.budget.maxTime) {
      this.errors.push('Reached time limit');
      return false;
    }

    return true;
  }

  /**
   * Check safety before operations.
   */
  private async checkSafety(): Promise<{ allowed: boolean; reason?: string }> {
    // Assess trifecta risk using the TrifectaAssessor.assess() method
    const assessment = this.trifecta.assess({
      privateData: {
        present: this.hasAccessToSecrets(),
        types: [],
        sensitivity: 'medium',
        encrypted: false,
        accessControlled: true,
      },
      untrustedInput: {
        present: true, // User input is always untrusted
        sources: ['user_direct'],
        sanitized: true,
        validated: true,
        truncated: true,
      },
      externalActions: {
        present: this.config.tools.executeTools,
        types: this.config.tools.executeTools ? ['execute_code'] : [],
        reversible: false,
        confirmed: false,
        audited: true,
      },
    });

    if (assessment.risk === 'critical' && !this.config.safety.sandboxMode) {
      return {
        allowed: false,
        reason: `Critical trifecta risk: ${assessment.vulnerabilities.join(', ')}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if agent has access to secrets.
   */
  private hasAccessToSecrets(): boolean {
    // Check if any allowed paths might contain secrets
    const secretPatterns = ['.env', 'credentials', 'secrets', '.aws', '.ssh'];
    return this.config.safety.allowedPaths.some(p =>
      secretPatterns.some(pattern => p.includes(pattern))
    );
  }

  /**
   * Get the system prompt.
   */
  private getSystemPrompt(): string {
    return `You are a helpful assistant that completes tasks by using the available tools.

IMPORTANT: When you have completed the task, you MUST call the 'done' tool with a summary of what was accomplished. This is the ONLY way to signal completion.

Available capabilities:
${this.config.tools.fileTools ? '- Read and write files' : ''}
${this.config.tools.searchTools ? '- Search files and directories' : ''}
${this.config.tools.executeTools ? '- Execute shell commands' : ''}

Constraints:
- Maximum ${this.config.budget.maxIterations} iterations
- File operations limited to: ${this.config.safety.allowedPaths.join(', ')}
${this.config.safety.sandboxMode ? '- Running in sandbox mode' : ''}

Always explain your reasoning before taking actions. Use the 'think' tool if you need to reason through a complex problem.`;
  }

  /**
   * Convert tool to LLM format.
   */
  private toolToLLMTool(tool: Tool): LLMTool {
    return {
      name: tool.definition.name,
      description: tool.definition.description,
      input_schema: tool.definition.inputSchema,
    };
  }

  /**
   * Record an event.
   */
  private recordEvent(event: SimpleAgentEvent): void {
    this.eventStore.append(event);

    if (this.config.safety.auditLogging) {
      this.ops.log('debug', `Event: ${event.type}`, event);
    }
  }

  /**
   * Get the final result.
   */
  private getResult(): AgentResult {
    return {
      result: this.finalResult || 'Task not completed',
      success: this.completed && this.errors.length === 0,
      metrics: {
        iterations: this.iterations,
        tokensUsed: this.tokensUsed,
        durationMs: Date.now() - this.startTime,
        toolCalls: this.toolCallCount,
      },
      events: this.eventStore.getEvents(),
      errors: this.errors.length > 0 ? this.errors : undefined,
    };
  }

  /**
   * Reset agent state.
   */
  private reset(): void {
    this.messages = [];
    this.completed = false;
    this.finalResult = '';
    this.iterations = 0;
    this.tokensUsed = 0;
    this.toolCallCount = 0;
    this.startTime = 0;
    this.errors = [];
    this.eventStore.clear();
    this.ops.reset();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an agent with defaults.
 */
export function createAgent(
  client: LLMClient,
  config?: Partial<AgentConfig>
): Agent {
  return new Agent(client, config);
}

