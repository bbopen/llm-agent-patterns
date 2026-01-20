/**
 * eval-harness.ts - Complete Evaluation Harness
 *
 * Derivation:
 * - Statistical Testing: "Test distributions, not single runs"
 * - MLOps: "Continuous evaluation enables continuous improvement"
 * - Report 28: "Evaluation is infrastructure, not an afterthought"
 *
 * This harness combines all evaluation components into
 * a complete system for agent testing and benchmarking.
 */

import {
  EvaluationConfig,
  EvaluationResult,
  RunResult,
  createEvaluator,
} from '../evaluator';
import {
  TraceCollector,
  TraceStorage,
  ExecutionTrace,
  createTraceCollector,
  createTraceStorage,
} from '../trace';
import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Benchmark task definition.
 */
export interface BenchmarkTask {
  /** Unique task identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Task input/prompt */
  input: string;

  /** Expected behaviors (for manual review) */
  expectedBehaviors?: string[];

  /** Automated success criteria */
  successCriteria: (result: RunResult, trace?: ExecutionTrace) => boolean;

  /** Task difficulty */
  difficulty: 'easy' | 'medium' | 'hard';

  /** Task category */
  category?: string;

  /** Timeout override */
  timeout?: number;

  /** Number of runs override */
  runs?: number;
}

/**
 * Benchmark suite definition.
 */
export interface BenchmarkSuite {
  /** Suite name */
  name: string;

  /** Suite description */
  description: string;

  /** Tasks in the suite */
  tasks: BenchmarkTask[];

  /** Default timeout per task */
  defaultTimeout: number;

  /** Default runs per task */
  defaultRuns: number;

  /** Suite version */
  version: string;
}

/**
 * Benchmark result for a task.
 */
export interface TaskBenchmarkResult {
  taskId: string;
  taskDescription: string;
  evaluation: EvaluationResult;
  traces: ExecutionTrace[];
}

/**
 * Complete benchmark result.
 */
export interface BenchmarkResult {
  /** Suite that was run */
  suite: BenchmarkSuite;

  /** Results per task */
  taskResults: TaskBenchmarkResult[];

  /** Aggregate metrics */
  aggregate: {
    totalTasks: number;
    successfulTasks: number;
    overallSuccessRate: number;
    avgSuccessRatePerTask: number;
    totalRuns: number;
    totalDurationMs: number;
  };

  /** Timestamp */
  timestamp: number;

  /** Version identifier */
  version?: string;
}

/**
 * Agent runner function type.
 */
export type AgentRunner = (
  task: string,
  traceCollector?: TraceCollector
) => Promise<{
  success: boolean;
  response?: string;
  error?: string;
  tokensUsed: number;
  iterations: number;
  toolCalls: number;
}>;

// =============================================================================
// Evaluation Harness
// =============================================================================

/**
 * Complete evaluation harness for agent testing.
 *
 * Derivation (Infrastructure):
 * "Evaluation should be as easy as running tests.
 * Automate everything: runs, traces, comparisons, reports."
 */
export class EvaluationHarness {
  private storagePath: string;
  private traceStorage: TraceStorage | null = null;
  private agentRunner: AgentRunner;

  constructor(config: {
    storagePath: string;
    agentRunner: AgentRunner;
  }) {
    this.storagePath = config.storagePath;
    this.agentRunner = config.agentRunner;
  }

  /**
   * Initialize the harness.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(path.join(this.storagePath, 'traces'), { recursive: true });
    await fs.mkdir(path.join(this.storagePath, 'results'), { recursive: true });
    await fs.mkdir(path.join(this.storagePath, 'baselines'), { recursive: true });

    this.traceStorage = await createTraceStorage(
      path.join(this.storagePath, 'traces')
    );
  }

  /**
   * Run a single evaluation.
   */
  async runEvaluation(config: EvaluationConfig): Promise<{
    evaluation: EvaluationResult;
    traces: ExecutionTrace[];
  }> {
    const traces: ExecutionTrace[] = [];

    // Create runner that captures traces
    const runWithTracing = async (
      task: string,
      runId: string
    ): Promise<Omit<RunResult, 'id'>> => {
      const collector = createTraceCollector(task, {
        includeMessages: true,
        includeToolDetails: true,
      });

      const startTime = Date.now();

      try {
        const result = await this.agentRunner(task, collector);

        const trace = collector.complete(result.success, result.response, result.error);
        traces.push(trace);

        // Save trace
        if (this.traceStorage) {
          await this.traceStorage.save(trace);
        }

        return {
          success: result.success,
          response: result.response,
          error: result.error,
          durationMs: Date.now() - startTime,
          tokensUsed: result.tokensUsed,
          iterations: result.iterations,
          toolCalls: result.toolCalls,
          timedOut: false,
        };
      } catch (error) {
        const isTimeout = String(error).includes('Timeout');
        const trace = collector.complete(false, undefined, String(error));
        traces.push(trace);

        if (this.traceStorage) {
          await this.traceStorage.save(trace);
        }

        return {
          success: false,
          error: String(error),
          durationMs: Date.now() - startTime,
          tokensUsed: 0,
          iterations: 0,
          toolCalls: 0,
          timedOut: isTimeout,
        };
      }
    };

    const evaluator = createEvaluator(runWithTracing);
    const evaluation = await evaluator.evaluate(config);

    return { evaluation, traces };
  }

  /**
   * Run a benchmark suite.
   */
  async runBenchmark(suite: BenchmarkSuite): Promise<BenchmarkResult> {
    const taskResults: TaskBenchmarkResult[] = [];
    const startTime = Date.now();

    console.log(`Running benchmark: ${suite.name}`);
    console.log(`Tasks: ${suite.tasks.length}`);

    for (const task of suite.tasks) {
      console.log(`\n  Running: ${task.id} (${task.difficulty})`);

      const { evaluation, traces } = await this.runEvaluation({
        task: task.input,
        runs: task.runs || suite.defaultRuns,
        timeout: task.timeout || suite.defaultTimeout,
        tags: [suite.name, task.category || 'uncategorized', task.difficulty],
        successCriteria: (result) => {
          const trace = traces.find(t => t.id === result.id);
          return task.successCriteria(result, trace);
        },
      });

      taskResults.push({
        taskId: task.id,
        taskDescription: task.description,
        evaluation,
        traces,
      });

      console.log(`    Success rate: ${(evaluation.metrics.successRate * 100).toFixed(1)}%`);
    }

    // Calculate aggregate metrics
    const totalRuns = taskResults.reduce(
      (sum, r) => sum + r.evaluation.runs.length,
      0
    );

    const totalSuccesses = taskResults.reduce(
      (sum, r) => sum + r.evaluation.runs.filter(run => run.success).length,
      0
    );

    const successfulTasks = taskResults.filter(
      r => r.evaluation.metrics.successRate >= 0.5
    ).length;

    const avgSuccessRate = taskResults.reduce(
      (sum, r) => sum + r.evaluation.metrics.successRate,
      0
    ) / taskResults.length;

    const result: BenchmarkResult = {
      suite,
      taskResults,
      aggregate: {
        totalTasks: suite.tasks.length,
        successfulTasks,
        overallSuccessRate: totalRuns > 0 ? totalSuccesses / totalRuns : 0,
        avgSuccessRatePerTask: avgSuccessRate,
        totalRuns,
        totalDurationMs: Date.now() - startTime,
      },
      timestamp: Date.now(),
    };

    // Save result
    await this.saveBenchmarkResult(result);

    return result;
  }

  /**
   * Save a benchmark result.
   */
  async saveBenchmarkResult(result: BenchmarkResult): Promise<string> {
    const filename = `${result.suite.name}-${result.timestamp}.json`;
    const filepath = path.join(this.storagePath, 'results', filename);

    await fs.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');

    return filepath;
  }

  /**
   * Load a benchmark result.
   */
  async loadBenchmarkResult(filepath: string): Promise<BenchmarkResult> {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Save a baseline for comparison.
   */
  async saveBaseline(name: string, result: BenchmarkResult): Promise<void> {
    const filepath = path.join(this.storagePath, 'baselines', `${name}.json`);
    await fs.writeFile(filepath, JSON.stringify(result, null, 2), 'utf-8');
  }

  /**
   * Load a baseline.
   */
  async loadBaseline(name: string): Promise<BenchmarkResult | undefined> {
    const filepath = path.join(this.storagePath, 'baselines', `${name}.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  /**
   * Compare current results to baseline.
   */
  async compareToBaseline(
    current: BenchmarkResult,
    baselineName: string
  ): Promise<{
    hasBaseline: boolean;
    improved: boolean;
    regressions: string[];
    improvements: string[];
    taskComparisons: Array<{
      taskId: string;
      baseline: number;
      current: number;
      diff: number;
    }>;
  }> {
    const baseline = await this.loadBaseline(baselineName);

    if (!baseline) {
      return {
        hasBaseline: false,
        improved: false,
        regressions: [],
        improvements: [],
        taskComparisons: [],
      };
    }

    const regressions: string[] = [];
    const improvements: string[] = [];
    const taskComparisons: Array<{
      taskId: string;
      baseline: number;
      current: number;
      diff: number;
    }> = [];

    // Compare overall metrics
    const successDiff =
      current.aggregate.overallSuccessRate - baseline.aggregate.overallSuccessRate;

    if (successDiff < -0.05) {
      regressions.push(
        `Overall success rate dropped: ${(baseline.aggregate.overallSuccessRate * 100).toFixed(1)}% -> ${(current.aggregate.overallSuccessRate * 100).toFixed(1)}%`
      );
    } else if (successDiff > 0.05) {
      improvements.push(
        `Overall success rate improved: ${(baseline.aggregate.overallSuccessRate * 100).toFixed(1)}% -> ${(current.aggregate.overallSuccessRate * 100).toFixed(1)}%`
      );
    }

    // Compare per-task
    for (const currentTask of current.taskResults) {
      const baselineTask = baseline.taskResults.find(
        t => t.taskId === currentTask.taskId
      );

      if (!baselineTask) continue;

      const baselineRate = baselineTask.evaluation.metrics.successRate;
      const currentRate = currentTask.evaluation.metrics.successRate;
      const diff = currentRate - baselineRate;

      taskComparisons.push({
        taskId: currentTask.taskId,
        baseline: baselineRate,
        current: currentRate,
        diff,
      });

      if (diff < -0.1) {
        regressions.push(
          `Task ${currentTask.taskId}: ${(baselineRate * 100).toFixed(1)}% -> ${(currentRate * 100).toFixed(1)}%`
        );
      } else if (diff > 0.1) {
        improvements.push(
          `Task ${currentTask.taskId}: ${(baselineRate * 100).toFixed(1)}% -> ${(currentRate * 100).toFixed(1)}%`
        );
      }
    }

    return {
      hasBaseline: true,
      improved: improvements.length > regressions.length,
      regressions,
      improvements,
      taskComparisons,
    };
  }

  /**
   * Generate a benchmark report.
   */
  generateBenchmarkReport(result: BenchmarkResult): string {
    const lines = [
      `# Benchmark Report: ${result.suite.name}`,
      ``,
      `**Date**: ${new Date(result.timestamp).toISOString()}`,
      `**Suite Version**: ${result.suite.version}`,
      ``,
      `## Summary`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Tasks | ${result.aggregate.totalTasks} |`,
      `| Successful Tasks (≥50%) | ${result.aggregate.successfulTasks} |`,
      `| Overall Success Rate | ${(result.aggregate.overallSuccessRate * 100).toFixed(1)}% |`,
      `| Avg Success Rate per Task | ${(result.aggregate.avgSuccessRatePerTask * 100).toFixed(1)}% |`,
      `| Total Runs | ${result.aggregate.totalRuns} |`,
      `| Total Duration | ${(result.aggregate.totalDurationMs / 1000).toFixed(1)}s |`,
      ``,
      `## Task Results`,
      ``,
      `| Task | Difficulty | Success Rate | 95% CI | Avg Duration |`,
      `|------|------------|--------------|--------|--------------|`,
    ];

    for (const taskResult of result.taskResults) {
      const task = result.suite.tasks.find(t => t.id === taskResult.taskId);
      const m = taskResult.evaluation.metrics;
      const [ciLow, ciHigh] = m.confidenceInterval;

      lines.push(
        `| ${taskResult.taskId} | ${task?.difficulty || '-'} | ${(m.successRate * 100).toFixed(1)}% | [${(ciLow * 100).toFixed(0)}%, ${(ciHigh * 100).toFixed(0)}%] | ${m.avgDurationMs.toFixed(0)}ms |`
      );
    }

    // Add detailed results
    lines.push(``, `## Detailed Results`, ``);

    for (const taskResult of result.taskResults) {
      const m = taskResult.evaluation.metrics;

      lines.push(
        `### ${taskResult.taskId}`,
        ``,
        `${taskResult.taskDescription}`,
        ``,
        `- Success Rate: ${(m.successRate * 100).toFixed(1)}%`,
        `- Avg Duration: ${m.avgDurationMs.toFixed(0)}ms`,
        `- Avg Tokens: ${m.avgTokens.toFixed(0)}`,
        `- Avg Iterations: ${m.avgIterations.toFixed(1)}`,
        ``
      );
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Example Benchmark Suite
// =============================================================================

/**
 * Example benchmark suite for code generation tasks.
 */
export const codeGenerationSuite: BenchmarkSuite = {
  name: 'code-generation',
  description: 'Benchmark suite for code generation tasks',
  version: '1.0.0',
  defaultTimeout: 60000,
  defaultRuns: 20,
  tasks: [
    {
      id: 'fizzbuzz',
      description: 'Generate FizzBuzz implementation',
      input: 'Write a JavaScript function called fizzbuzz that takes a number n and returns an array of strings from 1 to n, where multiples of 3 are "Fizz", multiples of 5 are "Buzz", and multiples of both are "FizzBuzz".',
      difficulty: 'easy',
      category: 'algorithms',
      successCriteria: (result) =>
        result.success &&
        (result.response?.includes('function') ?? false) &&
        (result.response?.includes('Fizz') ?? false) &&
        (result.response?.includes('Buzz') ?? false),
    },
    {
      id: 'fibonacci',
      description: 'Generate recursive Fibonacci function',
      input: 'Write a JavaScript function called fibonacci that calculates the nth Fibonacci number using recursion with memoization.',
      difficulty: 'easy',
      category: 'algorithms',
      successCriteria: (result) =>
        result.success &&
        (result.response?.includes('function') ?? false) &&
        (result.response?.includes('fibonacci') ?? false),
    },
    {
      id: 'binary-search',
      description: 'Implement binary search algorithm',
      input: 'Write a TypeScript function called binarySearch that takes a sorted array of numbers and a target, and returns the index of the target or -1 if not found.',
      difficulty: 'medium',
      category: 'algorithms',
      successCriteria: (result) =>
        result.success &&
        (result.response?.includes('function') ?? false) &&
        (result.response?.includes('binarySearch') ?? false),
    },
    {
      id: 'debounce',
      description: 'Implement debounce utility',
      input: 'Write a TypeScript debounce function that takes a callback and a delay in milliseconds, and returns a debounced version of the callback.',
      difficulty: 'medium',
      category: 'utilities',
      successCriteria: (result) =>
        result.success &&
        (result.response?.includes('function') ?? false) &&
        (result.response?.includes('debounce') ?? false),
    },
  ],
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an evaluation harness.
 */
export async function createEvaluationHarness(config: {
  storagePath: string;
  agentRunner: AgentRunner;
}): Promise<EvaluationHarness> {
  const harness = new EvaluationHarness(config);
  await harness.initialize();
  return harness;
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Running a benchmark.
 *
 * ```typescript
 * import { createEvaluationHarness, codeGenerationSuite } from './eval-harness';
 * import { runAgent } from '../../01-the-loop/minimal-agent';
 * import { standardTools } from '../../02-tool-design/examples/basic-tools';
 *
 * async function runBenchmarks() {
 *   // Create harness
 *   const harness = await createEvaluationHarness({
 *     storagePath: '.eval',
 *     agentRunner: async (task, traceCollector) => {
 *       // Integrate trace collection with agent
 *       const result = await runAgent(task, standardTools);
 *
 *       return {
 *         success: result.success,
 *         response: result.response,
 *         error: result.error,
 *         tokensUsed: result.tokensUsed || 0,
 *         iterations: result.iterations || 0,
 *         toolCalls: result.toolCalls || 0,
 *       };
 *     },
 *   });
 *
 *   // Run benchmark
 *   const result = await harness.runBenchmark(codeGenerationSuite);
 *
 *   // Generate report
 *   const report = harness.generateBenchmarkReport(result);
 *   console.log(report);
 *
 *   // Compare to baseline
 *   const comparison = await harness.compareToBaseline(result, 'main');
 *
 *   if (comparison.hasBaseline) {
 *     console.log('Regressions:', comparison.regressions);
 *     console.log('Improvements:', comparison.improvements);
 *   } else {
 *     // Save as new baseline
 *     await harness.saveBaseline('main', result);
 *   }
 * }
 * ```
 */

