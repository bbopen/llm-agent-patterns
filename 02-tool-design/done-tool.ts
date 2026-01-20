/**
 * done-tool.ts - Explicit Termination Pattern
 *
 * Derivation:
 * - Report 28: "The naive approach—stop when no tool calls—fails"
 * - Report 11 (Claude Code): Implements explicit termination
 * - Production experience: Agents prematurely finish when confused
 *
 * The done tool forces explicit "I'm done" rather than implicit silence.
 */

import { z } from 'zod';
import { createTool, Tool } from './tool-types';

// =============================================================================
// Task Completion Signal
// =============================================================================

/**
 * Thrown when the done tool is called, signaling task completion.
 * Catch this in your agent loop to extract the final result.
 */
export class TaskComplete extends Error {
  constructor(
    public readonly summary: string,
    public readonly result?: string,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(`Task complete: ${summary}`);
    this.name = 'TaskComplete';
  }
}

// =============================================================================
// Done Tool Variants
// =============================================================================

/**
 * Input schema for the done tool.
 */
const doneInputSchema = {
  type: 'object' as const,
  properties: {
    summary: {
      type: 'string' as const,
      description: 'Brief summary of what was accomplished (1-2 sentences)',
    },
    result: {
      type: 'string' as const,
      description: 'The final result, answer, or output if applicable',
    },
  },
  required: ['summary'] as const,
  additionalProperties: false as const,
};

/**
 * Zod validator for done tool input.
 */
const doneInputValidator = z.object({
  summary: z.string().min(1),
  result: z.string().optional(),
});

type DoneInput = z.infer<typeof doneInputValidator>;

/**
 * Standard done tool.
 *
 * Use this when:
 * - Task completion is binary (done or not done)
 * - You want simple success signaling
 *
 * @example
 * const result = await runAgent(task, [...tools, doneTool]);
 */
export const doneTool: Tool<DoneInput> = createTool({
  name: 'task_complete',
  description: `Signal that the current task is complete.

Call this ONLY when you have fully accomplished the user's request.
Do NOT call this if:
- You encountered an error you couldn't resolve
- The task is only partially complete
- You need more information to proceed

Include a brief summary of what was accomplished.`,
  inputSchema: doneInputSchema,
  inputValidator: doneInputValidator,
  execute: async (input) => {
    throw new TaskComplete(input.summary, input.result);
  },
});

/**
 * Done tool with structured result.
 *
 * Use this when:
 * - You need typed completion data
 * - Results should conform to a specific schema
 *
 * @example
 * const analysisDoneTool = createStructuredDoneTool({
 *   name: 'analysis_complete',
 *   resultSchema: z.object({
 *     findings: z.array(z.string()),
 *     severity: z.enum(['low', 'medium', 'high']),
 *   }),
 * });
 */
export function createStructuredDoneTool<TResult>(config: {
  name: string;
  description?: string;
  resultSchema: z.ZodType<TResult>;
}): Tool<{ summary: string; result: TResult }> {
  const inputValidator = z.object({
    summary: z.string().min(1),
    result: config.resultSchema,
  });

  return createTool({
    name: config.name,
    description: config.description || `Signal completion with structured result.`,
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of what was accomplished',
        },
        result: {
          type: 'object',
          description: 'Structured result data',
          properties: {}, // LLM infers structure from description
        },
      },
      required: ['summary', 'result'],
      additionalProperties: false,
    },
    inputValidator,
    execute: async (input) => {
      throw new TaskComplete(
        input.summary,
        JSON.stringify(input.result),
        { structuredResult: input.result }
      );
    },
  }) as Tool<{ summary: string; result: TResult }>;
}

/**
 * Done tool with failure option.
 *
 * Use this when:
 * - Agent should distinguish success from failure
 * - You want explicit failure reasons
 *
 * @example
 * const result = await runAgent(task, [...tools, doneOrFailTool]);
 * if (result.success) { ... } else { ... }
 */
export const doneOrFailTool: Tool<{
  success: boolean;
  summary: string;
  result?: string;
  failureReason?: string;
}> = createTool({
  name: 'task_complete',
  description: `Signal task completion or failure.

Call with success=true when the task is fully accomplished.
Call with success=false when the task cannot be completed.

For failures, include a clear failureReason explaining what went wrong.`,
  inputSchema: {
    type: 'object',
    properties: {
      success: {
        type: 'boolean',
        description: 'Whether the task was completed successfully',
      },
      summary: {
        type: 'string',
        description: 'Brief summary of outcome',
      },
      result: {
        type: 'string',
        description: 'Final result if successful',
      },
      failureReason: {
        type: 'string',
        description: 'Explanation of failure if not successful',
      },
    },
    required: ['success', 'summary'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    success: z.boolean(),
    summary: z.string().min(1),
    result: z.string().optional(),
    failureReason: z.string().optional(),
  }),
  execute: async (input) => {
    throw new TaskComplete(
      input.summary,
      input.result,
      {
        success: input.success,
        failureReason: input.failureReason,
      }
    );
  },
});

// =============================================================================
// Agent Loop Integration
// =============================================================================

/**
 * Check if an error is a TaskComplete signal.
 */
export function isTaskComplete(error: unknown): error is TaskComplete {
  return error instanceof TaskComplete;
}

/**
 * Extract completion data from TaskComplete error.
 */
export function extractCompletion(error: TaskComplete): {
  summary: string;
  result?: string;
  success: boolean;
  metadata?: Record<string, unknown>;
} {
  const success = error.metadata?.success !== false;
  return {
    summary: error.summary,
    result: error.result,
    success,
    metadata: error.metadata,
  };
}

/**
 * Example integration with agent loop:
 *
 * ```typescript
 * try {
 *   const result = await tool.execute(input);
 *   // Normal tool result handling
 * } catch (error) {
 *   if (isTaskComplete(error)) {
 *     const completion = extractCompletion(error);
 *     return {
 *       response: completion.result || completion.summary,
 *       success: completion.success,
 *     };
 *   }
 *   // Handle other errors
 *   throw error;
 * }
 * ```
 */
