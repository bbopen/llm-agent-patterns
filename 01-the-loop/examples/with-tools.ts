/**
 * with-tools.ts - Agent with Tool Execution
 *
 * Derivation:
 * - Ashby (1956): "Only variety can absorb variety" - tools expand agent capability
 * - Report 10: Tool definitions should be clear, with strict schemas
 * - Report 28: "Give the model complete action space"
 *
 * This example shows a multi-turn agent that uses tools to accomplish a task.
 *
 * Run: npx ts-node examples/with-tools.ts
 */

import { runAgent } from '../minimal-agent';
import { Tool } from '../types';

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Calculator tool.
 *
 * Derivation (Report 10):
 * - Clear name: "calculate" not "do_math"
 * - Specific description: includes supported operations
 * - Strict schema: additionalProperties: false
 */
const calculatorTool: Tool = {
  definition: {
    name: 'calculate',
    description: 'Perform basic arithmetic. Supports add, subtract, multiply, divide.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: ['add', 'subtract', 'multiply', 'divide'],
        },
        a: {
          type: 'number',
          description: 'First operand',
        },
        b: {
          type: 'number',
          description: 'Second operand',
        },
      },
      required: ['operation', 'a', 'b'],
      additionalProperties: false,
    },
  },
  execute: async (input) => {
    const { operation, a, b } = input as { operation: string; a: number; b: number };

    switch (operation) {
      case 'add':
        return String(a + b);
      case 'subtract':
        return String(a - b);
      case 'multiply':
        return String(a * b);
      case 'divide':
        if (b === 0) return 'Error: Division by zero';
        return String(a / b);
      default:
        return `Error: Unknown operation "${operation}"`;
    }
  },
};

/**
 * Get current time tool.
 *
 * Derivation:
 * - Shows tools can access real-world state
 * - Agent doesn't need to know current time—it can ask
 */
const timeTool: Tool = {
  definition: {
    name: 'get_current_time',
    description: 'Get the current date and time in ISO format.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  execute: async () => {
    return new Date().toISOString();
  },
};

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('Running agent with tools...\n');

  const result = await runAgent(
    `I need to calculate the following:
    1. What is 42 * 17?
    2. What is that result divided by 6?
    3. What time is it right now?

    Please perform these calculations and tell me the final answers.`,
    [calculatorTool, timeTool],
    {
      maxIterations: 10,
      systemPrompt: `You are a helpful assistant with access to a calculator and clock.
Use the tools to answer questions. Show your work.`,
    }
  );

  console.log('='.repeat(60));
  console.log('RESULT');
  console.log('='.repeat(60));
  console.log('\nResponse:\n', result.response);
  console.log('\nSuccess:', result.success);
  console.log('Iterations:', result.iterations);
  console.log('Tokens used:', result.totalTokens);

  // Show the conversation flow
  console.log('\n' + '='.repeat(60));
  console.log('CONVERSATION FLOW');
  console.log('='.repeat(60));

  for (const msg of result.messages) {
    console.log(`\n[${msg.role.toUpperCase()}]`);
    if (typeof msg.content === 'string') {
      console.log(msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : ''));
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          console.log(`  TEXT: ${block.text.substring(0, 100)}...`);
        } else if (block.type === 'tool_use') {
          console.log(`  TOOL_USE: ${block.name}(${JSON.stringify(block.input)})`);
        } else if (block.type === 'tool_result') {
          console.log(`  TOOL_RESULT: ${block.content}`);
        }
      }
    }
  }
}

main().catch(console.error);

/**
 * Expected behavior:
 *
 * The agent will:
 * 1. Call calculate(multiply, 42, 17) → 714
 * 2. Call calculate(divide, 714, 6) → 119
 * 3. Call get_current_time() → current ISO timestamp
 * 4. Summarize results in natural language
 *
 * This demonstrates the feedback loop:
 * - LLM generates tool calls
 * - Your code executes them
 * - Results feed back to LLM
 * - LLM generates more calls or completes
 *
 * The loop continues until:
 * - LLM stops calling tools (end_turn)
 * - Max iterations reached
 */
