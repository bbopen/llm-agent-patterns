/**
 * evaluator.ts - Statistical Evaluation Framework
 *
 * Derivation:
 * - Statistical Theory: "Stochastic systems require distribution testing"
 * - Report 26: "60-70% reliable per step; single tests prove nothing"
 * - Report 28: "Evaluation is a distribution problem"
 *
 * This framework provides statistical evaluation for agent systems,
 * where single-run tests are meaningless.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for an evaluation run.
 */
export interface EvaluationConfig {
  /** Task description or input */
  task: string;

  /** Number of runs to perform */
  runs: number;

  /** Timeout per run in milliseconds */
  timeout: number;

  /** Maximum concurrent runs */
  concurrency?: number;

  /** Tags for categorization */
  tags?: string[];

  /** Custom success criteria */
  successCriteria?: (result: RunResult) => boolean;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a single run.
 */
export interface RunResult {
  /** Run identifier */
  id: string;

  /** Whether the run succeeded */
  success: boolean;

  /** Output/response from the agent */
  response?: string;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Tokens used */
  tokensUsed: number;

  /** Number of iterations */
  iterations: number;

  /** Tool calls made */
  toolCalls: number;

  /** Whether it timed out */
  timedOut: boolean;

  /** Custom metrics */
  customMetrics?: Record<string, number>;
}

/**
 * Statistical metrics for an evaluation.
 */
export interface EvaluationMetrics {
  /** Success rate (0-1) */
  successRate: number;

  /** Standard deviation of success rate */
  successStdDev: number;

  /** 95% confidence interval for success rate */
  confidenceInterval: [number, number];

  /** Average duration for successful runs */
  avgDurationMs: number;

  /** P95 duration */
  p95DurationMs: number;

  /** Average tokens used */
  avgTokens: number;

  /** Average iterations */
  avgIterations: number;

  /** Timeout rate */
  timeoutRate: number;

  /** Error rate (excluding timeouts) */
  errorRate: number;
}

/**
 * Complete evaluation result.
 */
export interface EvaluationResult {
  /** Evaluation identifier */
  id: string;

  /** Configuration used */
  config: EvaluationConfig;

  /** Individual run results */
  runs: RunResult[];

  /** Aggregated metrics */
  metrics: EvaluationMetrics;

  /** Timestamp of evaluation */
  timestamp: number;

  /** Total duration */
  totalDurationMs: number;
}

// =============================================================================
// Statistical Helpers
// =============================================================================

/**
 * Calculate standard deviation.
 */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Calculate percentile.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Calculate 95% confidence interval for a proportion.
 */
function confidenceInterval95(
  successRate: number,
  sampleSize: number
): [number, number] {
  if (sampleSize === 0) return [0, 0];

  // Wilson score interval (more accurate for edge cases)
  const z = 1.96; // 95% confidence
  const n = sampleSize;
  const p = successRate;

  const denominator = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);

  const lower = Math.max(0, (center - margin) / denominator);
  const upper = Math.min(1, (center + margin) / denominator);

  return [lower, upper];
}

// =============================================================================
// Evaluator
// =============================================================================

/**
 * Run function type.
 */
export type RunFunction = (
  task: string,
  runId: string
) => Promise<Omit<RunResult, 'id'>>;

/**
 * Statistical evaluator for agent systems.
 *
 * Derivation (Statistical Testing):
 * "For stochastic systems, test the distribution of outcomes.
 * A single pass/fail tells you nothing about reliability."
 */
export class Evaluator {
  private runFn: RunFunction;

  constructor(runFn: RunFunction) {
    this.runFn = runFn;
  }

  /**
   * Run an evaluation.
   */
  async evaluate(config: EvaluationConfig): Promise<EvaluationResult> {
    const startTime = Date.now();
    const runs: RunResult[] = [];
    const concurrency = config.concurrency || 1;

    // Generate run IDs
    const runIds = Array.from(
      { length: config.runs },
      (_, i) => `run-${i + 1}`
    );

    // Execute runs with concurrency control
    const runPromises: Promise<RunResult>[] = [];
    const semaphore = new Semaphore(concurrency);

    for (const runId of runIds) {
      const runPromise = semaphore.acquire().then(async (release) => {
        try {
          const result = await this.executeRun(config, runId);
          runs.push(result);
          return result;
        } finally {
          release();
        }
      });

      runPromises.push(runPromise);
    }

    await Promise.all(runPromises);

    // Calculate metrics
    const metrics = this.calculateMetrics(runs, config);

    return {
      id: `eval-${Date.now()}`,
      config,
      runs,
      metrics,
      timestamp: Date.now(),
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single run.
   */
  private async executeRun(
    config: EvaluationConfig,
    runId: string
  ): Promise<RunResult> {
    const startTime = Date.now();

    try {
      // Race between run and timeout
      const result = await Promise.race([
        this.runFn(config.task, runId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), config.timeout)
        ),
      ]);

      // Apply custom success criteria if provided
      const success = config.successCriteria
        ? config.successCriteria({ id: runId, ...result })
        : result.success;

      return {
        id: runId,
        ...result,
        success,
        timedOut: false,
        durationMs: result.durationMs || Date.now() - startTime,
      };
    } catch (error) {
      const isTimeout = String(error).includes('Timeout');

      return {
        id: runId,
        success: false,
        error: String(error),
        durationMs: Date.now() - startTime,
        tokensUsed: 0,
        iterations: 0,
        toolCalls: 0,
        timedOut: isTimeout,
      };
    }
  }

  /**
   * Calculate aggregated metrics.
   */
  private calculateMetrics(
    runs: RunResult[],
    _config: EvaluationConfig
  ): EvaluationMetrics {
    const total = runs.length;
    const successes = runs.filter(r => r.success);
    const failures = runs.filter(r => !r.success && !r.timedOut);
    const timeouts = runs.filter(r => r.timedOut);

    const successRate = total > 0 ? successes.length / total : 0;

    // Success rate standard deviation (using binary outcomes)
    const successBinary = runs.map(r => (r.success ? 1 : 0));
    const successStdDev = stdDev(successBinary);

    // Duration metrics (successful runs only)
    const durations = successes.map(r => r.durationMs);
    const avgDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const p95DurationMs = percentile(durations, 95);

    // Token metrics
    const tokens = runs.map(r => r.tokensUsed);
    const avgTokens = tokens.length > 0
      ? tokens.reduce((a, b) => a + b, 0) / tokens.length
      : 0;

    // Iteration metrics
    const iterations = runs.map(r => r.iterations);
    const avgIterations = iterations.length > 0
      ? iterations.reduce((a, b) => a + b, 0) / iterations.length
      : 0;

    return {
      successRate,
      successStdDev,
      confidenceInterval: confidenceInterval95(successRate, total),
      avgDurationMs,
      p95DurationMs,
      avgTokens,
      avgIterations,
      timeoutRate: total > 0 ? timeouts.length / total : 0,
      errorRate: total > 0 ? failures.length / total : 0,
    };
  }
}

// =============================================================================
// Semaphore for Concurrency Control
// =============================================================================

/**
 * Simple semaphore for limiting concurrency.
 */
class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}

// =============================================================================
// Comparison Utilities
// =============================================================================

/**
 * Compare two evaluation results.
 */
export function compareEvaluations(
  baseline: EvaluationResult,
  current: EvaluationResult
): {
  improved: boolean;
  regressions: string[];
  improvements: string[];
  summary: string;
} {
  const regressions: string[] = [];
  const improvements: string[] = [];

  const bm = baseline.metrics;
  const cm = current.metrics;

  // Success rate comparison
  const successDiff = cm.successRate - bm.successRate;
  if (successDiff < -0.05) {
    regressions.push(
      `Success rate: ${(bm.successRate * 100).toFixed(1)}% -> ${(cm.successRate * 100).toFixed(1)}%`
    );
  } else if (successDiff > 0.05) {
    improvements.push(
      `Success rate: ${(bm.successRate * 100).toFixed(1)}% -> ${(cm.successRate * 100).toFixed(1)}%`
    );
  }

  // Duration comparison (for successful runs)
  if (cm.avgDurationMs > bm.avgDurationMs * 1.2) {
    regressions.push(
      `Avg duration: ${bm.avgDurationMs.toFixed(0)}ms -> ${cm.avgDurationMs.toFixed(0)}ms`
    );
  } else if (cm.avgDurationMs < bm.avgDurationMs * 0.8) {
    improvements.push(
      `Avg duration: ${bm.avgDurationMs.toFixed(0)}ms -> ${cm.avgDurationMs.toFixed(0)}ms`
    );
  }

  // Token efficiency
  if (cm.avgTokens > bm.avgTokens * 1.2) {
    regressions.push(
      `Avg tokens: ${bm.avgTokens.toFixed(0)} -> ${cm.avgTokens.toFixed(0)}`
    );
  } else if (cm.avgTokens < bm.avgTokens * 0.8) {
    improvements.push(
      `Avg tokens: ${bm.avgTokens.toFixed(0)} -> ${cm.avgTokens.toFixed(0)}`
    );
  }

  const improved = improvements.length > regressions.length;

  const summary = [
    `Success: ${(cm.successRate * 100).toFixed(1)}% (${successDiff >= 0 ? '+' : ''}${(successDiff * 100).toFixed(1)}%)`,
    `Duration: ${cm.avgDurationMs.toFixed(0)}ms`,
    `Tokens: ${cm.avgTokens.toFixed(0)}`,
    regressions.length > 0 ? `Regressions: ${regressions.length}` : null,
    improvements.length > 0 ? `Improvements: ${improvements.length}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return { improved, regressions, improvements, summary };
}

// =============================================================================
// Report Generation
// =============================================================================

/**
 * Generate a human-readable evaluation report.
 */
export function generateReport(result: EvaluationResult): string {
  const m = result.metrics;
  const [ciLow, ciHigh] = m.confidenceInterval;

  const lines = [
    `# Evaluation Report`,
    ``,
    `**Task**: ${result.config.task}`,
    `**Runs**: ${result.runs.length}`,
    `**Date**: ${new Date(result.timestamp).toISOString()}`,
    ``,
    `## Metrics`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Success Rate | ${(m.successRate * 100).toFixed(1)}% |`,
    `| 95% CI | [${(ciLow * 100).toFixed(1)}%, ${(ciHigh * 100).toFixed(1)}%] |`,
    `| Avg Duration | ${m.avgDurationMs.toFixed(0)}ms |`,
    `| P95 Duration | ${m.p95DurationMs.toFixed(0)}ms |`,
    `| Avg Tokens | ${m.avgTokens.toFixed(0)} |`,
    `| Avg Iterations | ${m.avgIterations.toFixed(1)} |`,
    `| Timeout Rate | ${(m.timeoutRate * 100).toFixed(1)}% |`,
    `| Error Rate | ${(m.errorRate * 100).toFixed(1)}% |`,
    ``,
    `## Run Distribution`,
    ``,
    `- Successes: ${result.runs.filter(r => r.success).length}`,
    `- Failures: ${result.runs.filter(r => !r.success && !r.timedOut).length}`,
    `- Timeouts: ${result.runs.filter(r => r.timedOut).length}`,
    ``,
  ];

  // Add failure details
  const failures = result.runs.filter(r => !r.success);
  if (failures.length > 0) {
    lines.push(`## Failures`);
    lines.push(``);

    for (const failure of failures.slice(0, 5)) {
      lines.push(`- **${failure.id}**: ${failure.error || 'Unknown error'}`);
    }

    if (failures.length > 5) {
      lines.push(`- ... and ${failures.length - 5} more`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an evaluator for an agent run function.
 */
export function createEvaluator(runFn: RunFunction): Evaluator {
  return new Evaluator(runFn);
}

