/**
 * trace.ts - Trace Capture and Analysis
 *
 * Derivation:
 * - Observability: "You can't improve what you can't measure"
 * - Report 28: "Traces enable debugging, comparison, and training"
 * - MLOps: "Capture everything for post-hoc analysis"
 *
 * Traces provide complete visibility into agent execution,
 * enabling debugging, regression detection, and improvement.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Message in the trace.
 */
export interface TraceMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * Tool call in the trace.
 */
export interface TraceToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: number;
}

/**
 * Tool result in the trace.
 */
export interface TraceToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  durationMs: number;
  timestamp: number;
}

/**
 * Single iteration in a trace.
 */
export interface TraceIteration {
  number: number;
  startTime: number;
  endTime: number;

  /** Messages sent to LLM */
  llmInput: TraceMessage[];

  /** Raw LLM output */
  llmOutput: string;

  /** Parsed tool calls */
  toolCalls: TraceToolCall[];

  /** Tool execution results */
  toolResults: TraceToolResult[];

  /** Tokens used this iteration */
  inputTokens: number;
  outputTokens: number;

  /** Stop reason */
  stopReason?: string;
}

/**
 * Complete execution trace.
 */
export interface ExecutionTrace {
  /** Unique trace identifier */
  id: string;

  /** Session identifier */
  sessionId?: string;

  /** Task that was executed */
  task: string;

  /** Whether execution succeeded */
  success: boolean;

  /** All iterations */
  iterations: TraceIteration[];

  /** Final result/response */
  finalResult?: string;

  /** Error if failed */
  error?: string;

  /** Timing */
  startTime: number;
  endTime: number;
  totalDurationMs: number;

  /** Token totals */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /** Tags for filtering */
  tags?: string[];
}

/**
 * Trace capture configuration.
 */
export interface TraceCaptureConfig {
  /** Include full message content */
  includeMessages?: boolean;

  /** Include full tool inputs/outputs */
  includeToolDetails?: boolean;

  /** Maximum content length to capture */
  maxContentLength?: number;

  /** Tags to add to all traces */
  defaultTags?: string[];

  /** Metadata to add to all traces */
  defaultMetadata?: Record<string, unknown>;
}

// =============================================================================
// Trace Collector
// =============================================================================

/**
 * Collects trace data during agent execution.
 *
 * Derivation (Observability):
 * "Every iteration, every tool call, every decision should be traceable.
 * Without traces, debugging is guesswork."
 */
export class TraceCollector {
  private trace: ExecutionTrace;
  private config: TraceCaptureConfig;
  private currentIteration: Partial<TraceIteration> | null = null;

  constructor(task: string, config: TraceCaptureConfig = {}) {
    this.config = {
      includeMessages: true,
      includeToolDetails: true,
      maxContentLength: 10000,
      ...config,
    };

    this.trace = {
      id: randomUUID(),
      task,
      success: false,
      iterations: [],
      startTime: Date.now(),
      endTime: 0,
      totalDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      tags: config.defaultTags,
      metadata: config.defaultMetadata,
    };
  }

  /**
   * Start a new iteration.
   */
  startIteration(number: number): void {
    this.currentIteration = {
      number,
      startTime: Date.now(),
      llmInput: [],
      toolCalls: [],
      toolResults: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  /**
   * Record LLM input.
   */
  recordLlmInput(messages: Array<{ role: string; content: string }>): void {
    if (!this.currentIteration) return;

    if (this.config.includeMessages) {
      this.currentIteration.llmInput = messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: this.truncate(m.content),
        timestamp: Date.now(),
      }));
    }
  }

  /**
   * Record LLM output.
   */
  recordLlmOutput(
    output: string,
    inputTokens: number,
    outputTokens: number,
    stopReason?: string
  ): void {
    if (!this.currentIteration) return;

    this.currentIteration.llmOutput = this.truncate(output);
    this.currentIteration.inputTokens = inputTokens;
    this.currentIteration.outputTokens = outputTokens;
    this.currentIteration.stopReason = stopReason;

    this.trace.totalInputTokens += inputTokens;
    this.trace.totalOutputTokens += outputTokens;
    this.trace.totalTokens += inputTokens + outputTokens;
  }

  /**
   * Record a tool call.
   */
  recordToolCall(id: string, name: string, input: Record<string, unknown>): void {
    if (!this.currentIteration) return;

    this.currentIteration.toolCalls?.push({
      id,
      name,
      input: this.config.includeToolDetails ? input : {},
      timestamp: Date.now(),
    });
  }

  /**
   * Record a tool result.
   */
  recordToolResult(
    toolCallId: string,
    content: string,
    isError: boolean,
    durationMs: number
  ): void {
    if (!this.currentIteration) return;

    this.currentIteration.toolResults?.push({
      toolCallId,
      content: this.config.includeToolDetails ? this.truncate(content) : '[truncated]',
      isError,
      durationMs,
      timestamp: Date.now(),
    });
  }

  /**
   * End the current iteration.
   */
  endIteration(): void {
    if (!this.currentIteration) return;

    this.currentIteration.endTime = Date.now();

    this.trace.iterations.push(this.currentIteration as TraceIteration);
    this.currentIteration = null;
  }

  /**
   * Mark trace as complete.
   */
  complete(success: boolean, finalResult?: string, error?: string): ExecutionTrace {
    this.trace.success = success;
    this.trace.finalResult = finalResult;
    this.trace.error = error;
    this.trace.endTime = Date.now();
    this.trace.totalDurationMs = this.trace.endTime - this.trace.startTime;

    return this.trace;
  }

  /**
   * Get the current trace.
   */
  getTrace(): ExecutionTrace {
    return this.trace;
  }

  /**
   * Add metadata.
   */
  addMetadata(key: string, value: unknown): void {
    this.trace.metadata = this.trace.metadata || {};
    this.trace.metadata[key] = value;
  }

  /**
   * Add tags.
   */
  addTags(...tags: string[]): void {
    this.trace.tags = this.trace.tags || [];
    this.trace.tags.push(...tags);
  }

  /**
   * Truncate content to max length.
   */
  private truncate(content: string): string {
    const max = this.config.maxContentLength || 10000;
    if (content.length <= max) return content;
    return content.substring(0, max) + `... [truncated ${content.length - max} chars]`;
  }
}

// =============================================================================
// Trace Storage
// =============================================================================

/**
 * Storage backend for traces.
 */
export class TraceStorage {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * Initialize storage.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
  }

  /**
   * Save a trace.
   */
  async save(trace: ExecutionTrace): Promise<string> {
    const filename = `${trace.id}.json`;
    const filepath = path.join(this.storagePath, filename);

    await fs.writeFile(filepath, JSON.stringify(trace, null, 2), 'utf-8');

    return filepath;
  }

  /**
   * Load a trace by ID.
   */
  async load(id: string): Promise<ExecutionTrace | undefined> {
    const filepath = path.join(this.storagePath, `${id}.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  /**
   * List all trace IDs.
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.storagePath);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete a trace.
   */
  async delete(id: string): Promise<boolean> {
    const filepath = path.join(this.storagePath, `${id}.json`);

    try {
      await fs.unlink(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Query traces by criteria.
   */
  async query(criteria: {
    success?: boolean;
    tags?: string[];
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<ExecutionTrace[]> {
    const ids = await this.list();
    const matches: ExecutionTrace[] = [];

    for (const id of ids) {
      if (criteria.limit && matches.length >= criteria.limit) break;

      const trace = await this.load(id);
      if (!trace) continue;

      // Apply filters
      if (criteria.success !== undefined && trace.success !== criteria.success) continue;
      if (criteria.startTime && trace.startTime < criteria.startTime) continue;
      if (criteria.endTime && trace.endTime > criteria.endTime) continue;
      if (criteria.tags && !criteria.tags.every(t => trace.tags?.includes(t))) continue;

      matches.push(trace);
    }

    return matches;
  }
}

// =============================================================================
// Trace Analysis
// =============================================================================

/**
 * Analyze a collection of traces.
 */
export function analyzeTraces(traces: ExecutionTrace[]): {
  totalTraces: number;
  successRate: number;
  avgDurationMs: number;
  avgTokens: number;
  avgIterations: number;
  commonErrors: Array<{ error: string; count: number }>;
  toolUsage: Array<{ tool: string; count: number; errorRate: number }>;
} {
  if (traces.length === 0) {
    return {
      totalTraces: 0,
      successRate: 0,
      avgDurationMs: 0,
      avgTokens: 0,
      avgIterations: 0,
      commonErrors: [],
      toolUsage: [],
    };
  }

  // Basic metrics
  const successes = traces.filter(t => t.success);
  const successRate = successes.length / traces.length;

  const avgDurationMs = traces.reduce((sum, t) => sum + t.totalDurationMs, 0) / traces.length;
  const avgTokens = traces.reduce((sum, t) => sum + t.totalTokens, 0) / traces.length;
  const avgIterations = traces.reduce((sum, t) => sum + t.iterations.length, 0) / traces.length;

  // Error analysis
  const errorCounts = new Map<string, number>();
  for (const trace of traces) {
    if (trace.error) {
      const normalized = normalizeError(trace.error);
      errorCounts.set(normalized, (errorCounts.get(normalized) || 0) + 1);
    }
  }

  const commonErrors = Array.from(errorCounts.entries())
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Tool usage analysis
  const toolStats = new Map<string, { calls: number; errors: number }>();
  for (const trace of traces) {
    for (const iteration of trace.iterations) {
      for (const call of iteration.toolCalls) {
        const stats = toolStats.get(call.name) || { calls: 0, errors: 0 };
        stats.calls++;

        const result = iteration.toolResults.find(r => r.toolCallId === call.id);
        if (result?.isError) {
          stats.errors++;
        }

        toolStats.set(call.name, stats);
      }
    }
  }

  const toolUsage = Array.from(toolStats.entries())
    .map(([tool, stats]) => ({
      tool,
      count: stats.calls,
      errorRate: stats.calls > 0 ? stats.errors / stats.calls : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalTraces: traces.length,
    successRate,
    avgDurationMs,
    avgTokens,
    avgIterations,
    commonErrors,
    toolUsage,
  };
}

/**
 * Normalize error messages for grouping.
 */
function normalizeError(error: string): string {
  // Remove unique identifiers, timestamps, etc.
  return error
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '[timestamp]')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[uuid]')
    .replace(/\d+ms/g, '[N]ms')
    .substring(0, 200);
}

/**
 * Compare two traces.
 */
export function compareTraces(
  trace1: ExecutionTrace,
  trace2: ExecutionTrace
): {
  sameDuration: boolean;
  sameIterationCount: boolean;
  sameToolSequence: boolean;
  durationDiff: number;
  iterationDiff: number;
  divergencePoint?: number;
} {
  const durationDiff = trace2.totalDurationMs - trace1.totalDurationMs;
  const iterationDiff = trace2.iterations.length - trace1.iterations.length;

  // Compare tool sequences
  const tools1 = trace1.iterations.flatMap(i => i.toolCalls.map(c => c.name));
  const tools2 = trace2.iterations.flatMap(i => i.toolCalls.map(c => c.name));

  let divergencePoint: number | undefined;
  for (let i = 0; i < Math.min(tools1.length, tools2.length); i++) {
    if (tools1[i] !== tools2[i]) {
      divergencePoint = i;
      break;
    }
  }

  return {
    sameDuration: Math.abs(durationDiff) < trace1.totalDurationMs * 0.1, // Within 10%
    sameIterationCount: trace1.iterations.length === trace2.iterations.length,
    sameToolSequence: JSON.stringify(tools1) === JSON.stringify(tools2),
    durationDiff,
    iterationDiff,
    divergencePoint,
  };
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a trace collector.
 */
export function createTraceCollector(
  task: string,
  config?: TraceCaptureConfig
): TraceCollector {
  return new TraceCollector(task, config);
}

/**
 * Create a trace storage backend.
 */
export async function createTraceStorage(
  storagePath: string
): Promise<TraceStorage> {
  const storage = new TraceStorage(storagePath);
  await storage.initialize();
  return storage;
}

