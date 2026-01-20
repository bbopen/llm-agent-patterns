/**
 * tools/index.ts - Tool Exports
 *
 * Derivation:
 * - Report 27: "The done tool is required for explicit termination"
 * - Ashby (1956): "Tools define the agent's action space"
 * - Report 26: "Start with full capabilities, restrict via policy"
 *
 * This module exports all tools available to the agent.
 * Tools are organized by category for clarity.
 */

import { Tool, createTool } from '../../02-tool-design/tool-types';
import { AgentConfig } from '../config';
import { createFileTools } from './file-tools';
import { createSearchTools } from './search-tools';

// =============================================================================
// Done Tool
// =============================================================================

/**
 * Create the done tool for explicit termination.
 *
 * Derivation (Report 27):
 * "Without an explicit done tool, agents either:
 * 1. Stop prematurely (no way to signal completion)
 * 2. Loop forever (no way to stop)
 * The done tool solves both."
 */
export function createDoneTool(
  onComplete: (result: string) => void
): Tool {
  return createTool({
    name: 'done',
    description: `Call this tool when you have completed the task.
This is the ONLY way to signal completion.
Include a summary of what was accomplished in the result parameter.`,
    inputSchema: {
      type: 'object',
      properties: {
        result: {
          type: 'string',
          description: 'Summary of what was accomplished',
        },
        success: {
          type: 'boolean',
          description: 'Whether the task was completed successfully',
        },
        artifacts: {
          type: 'array',
          items: { type: 'string', description: 'Artifact path' },
          description: 'List of files or artifacts created/modified',
        },
      },
      required: ['result'],
    },
    execute: async (input: {
      result: string;
      success?: boolean;
      artifacts?: string[];
    }): Promise<string> => {
      onComplete(input.result);
      return `Task completed: ${input.result}`;
    },
  }) as unknown as Tool;
}

// =============================================================================
// Think Tool
// =============================================================================

/**
 * Create a think tool for explicit reasoning.
 *
 * Derivation (Chain of Thought):
 * "Sometimes agents need to reason without acting.
 * The think tool makes reasoning explicit and traceable."
 */
export function createThinkTool(): Tool {
  return createTool({
    name: 'think',
    description: `Use this tool to think through a problem step by step.
This helps organize your reasoning before taking action.
No external effects - purely for reasoning.`,
    inputSchema: {
      type: 'object',
      properties: {
        thought: {
          type: 'string',
          description: 'Your reasoning or analysis',
        },
        conclusion: {
          type: 'string',
          description: 'What you concluded from this thinking',
        },
        nextSteps: {
          type: 'array',
          items: { type: 'string', description: 'Action step' },
          description: 'What actions to take based on this thinking',
        },
      },
      required: ['thought'],
    },
    execute: async (input: {
      thought: string;
      conclusion?: string;
      nextSteps?: string[];
    }): Promise<string> => {
      return `Thinking recorded:\n${input.thought}${
        input.conclusion ? `\n\nConclusion: ${input.conclusion}` : ''
      }${
        input.nextSteps ? `\n\nNext steps:\n${input.nextSteps.map(s => `- ${s}`).join('\n')}` : ''
      }`;
    },
  }) as unknown as Tool;
}

// =============================================================================
// Ask User Tool
// =============================================================================

/**
 * Create a tool for asking the user questions.
 *
 * Derivation (Human in the Loop):
 * "Agents should be able to ask for clarification
 * rather than guessing or failing silently."
 */
export function createAskUserTool(
  askFn: (question: string) => Promise<string>
): Tool {
  return createTool({
    name: 'ask_user',
    description: `Ask the user a question when you need clarification or additional information.
Use this when:
- The task is ambiguous
- You need to make a decision that affects the outcome
- You're unsure about the user's preferences`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user',
        },
        context: {
          type: 'string',
          description: 'Why you need this information',
        },
        options: {
          type: 'array',
          items: { type: 'string', description: 'Option choice' },
          description: 'Suggested options for the user to choose from',
        },
      },
      required: ['question'],
    },
    execute: async (input: {
      question: string;
      context?: string;
      options?: string[];
    }): Promise<string> => {
      const response = await askFn(input.question);
      return `User response: ${response}`;
    },
  }) as unknown as Tool;
}

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Complete tool set for the agent.
 */
export interface ToolSet {
  /** All tools available to the agent */
  all: Tool[];

  /** File operation tools */
  file: Tool[];

  /** Search tools */
  search: Tool[];

  /** Meta tools (done, think) */
  meta: Tool[];

  /** Tool lookup by name */
  byName: Map<string, Tool>;
}

/**
 * Create the complete tool set.
 *
 * @param config Agent configuration
 * @param onComplete Callback when agent calls done
 * @param askUser Callback when agent asks user (optional)
 */
export function createToolSet(
  config: AgentConfig,
  onComplete: (result: string) => void,
  askUser?: (question: string) => Promise<string>
): ToolSet {
  // Create tool categories
  const fileTools = config.tools.fileTools
    ? createFileTools(config)
    : [];

  const searchTools = config.tools.searchTools
    ? createSearchTools(config)
    : [];

  const metaTools: Tool[] = [
    createDoneTool(onComplete),
    createThinkTool(),
  ];

  if (askUser) {
    metaTools.push(createAskUserTool(askUser));
  }

  // Combine all tools
  const all = [...fileTools, ...searchTools, ...metaTools];

  // Create lookup map
  const byName = new Map<string, Tool>();
  for (const tool of all) {
    byName.set(tool.definition.name, tool);
  }

  return {
    all,
    file: fileTools,
    search: searchTools,
    meta: metaTools,
    byName,
  };
}

// =============================================================================
// Re-exports
// =============================================================================

export { createFileTools } from './file-tools';
export { createSearchTools } from './search-tools';

