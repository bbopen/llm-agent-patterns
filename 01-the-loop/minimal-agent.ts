/**
 * minimal-agent.ts - The Complete Agent in ~50 Lines
 *
 * Derivation:
 * - Wiener (1948): Feedback loop - observe, act, adjust
 * - Report 26: "The LLM is ONE LINE. Everything else is control structure."
 * - Report 28: "An agent is just a for-loop of tool calls."
 *
 * This is the entire architecture. Everything else is ops infrastructure.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  Message,
  Tool,
  ToolResult,
  AgentConfig,
  AgentResult,
  DEFAULT_CONFIG,
  extractToolCalls,
  extractText,
  hasToolCalls,
} from './types';

/**
 * The agent loop.
 *
 * This implements the architecture discovered by Wiener in 1948 and
 * implemented in every production system since 2024.
 */
export async function runAgent(
  task: string,
  tools: Tool[],
  config: Partial<AgentConfig> = {}
): Promise<AgentResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const client = new Anthropic();

  // Initialize conversation with user task
  const messages: Message[] = [
    { role: 'user', content: task }
  ];

  // Token tracking
  const totalTokens = { input: 0, output: 0 };

  // The loop (Wiener's feedback loop, 1948)
  for (let iteration = 0; iteration < cfg.maxIterations; iteration++) {
    // Query the stochastic generator (THE ONE LINE that couldn't exist before LLMs)
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: cfg.systemPrompt,
      tools: tools.map(t => ({
        name: t.definition.name,
        description: t.definition.description,
        input_schema: t.definition.inputSchema,
      })),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Track usage
    totalTokens.input += response.usage.input_tokens;
    totalTokens.output += response.usage.output_tokens;

    // Convert SDK content to our ContentBlock type
    const contentBlocks = response.content.map((block): import('./types').ContentBlock => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      } else if (block.type === 'tool_use') {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      }
      // Handle any other content types by treating as text
      return { type: 'text', text: '' };
    });

    // Add assistant response to conversation
    messages.push({
      role: 'assistant',
      content: contentBlocks,
    });

    // Check termination condition
    if (!hasToolCalls({ content: contentBlocks, stop_reason: response.stop_reason, usage: response.usage })) {
      // No tool calls = agent is done
      return {
        response: extractText(contentBlocks),
        success: true,
        iterations: iteration + 1,
        totalTokens,
        messages,
      };
    }

    // Execute tool calls (deterministic execution layer)
    const toolCalls = extractToolCalls(contentBlocks);
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = tools.find(t => t.definition.name === call.name);

      if (!tool) {
        results.push({
          tool_use_id: call.id,
          content: `Error: Unknown tool "${call.name}"`,
          is_error: true,
        });
        continue;
      }

      try {
        const output = await tool.execute(call.input);
        results.push({
          tool_use_id: call.id,
          content: output,
        });
      } catch (error) {
        results.push({
          tool_use_id: call.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        });
      }
    }

    // Feed results back (completing the feedback loop)
    messages.push({
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });
  }

  // Max iterations reached
  return {
    response: 'Agent reached maximum iterations without completing task.',
    success: false,
    iterations: cfg.maxIterations,
    totalTokens,
    messages,
  };
}

/**
 * That's it. That's the architecture.
 *
 * Everything else you might want to add:
 * - Retries with backoff → ops layer (see 07-ops)
 * - Validation before execution → validation layer (see 03-validation)
 * - Persistent state → memory layer (see 04-state-memory)
 * - Security checks → security layer (see 05-security)
 *
 * But the core loop doesn't change. It's been the same since 1948.
 */
