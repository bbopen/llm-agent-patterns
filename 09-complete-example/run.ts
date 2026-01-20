#!/usr/bin/env node
/**
 * run.ts - CLI Runner
 *
 * Derivation:
 * - Report 26: "Agents need a clean interface to the outside world"
 * - 12-Factor: "Treat logs as event streams"
 * - Unix Philosophy: "Write programs that do one thing well"
 *
 * This is the CLI entry point for the agent.
 * It handles argument parsing, configuration, and output.
 */

import { createAgent, Agent, LLMClient, LLMResponse, Message } from './agent';
import { AgentConfig, ConfigPresets } from './config';

// =============================================================================
// CLI Arguments
// =============================================================================

interface CLIArgs {
  task: string;
  preset: keyof typeof ConfigPresets | 'default';
  verbose: boolean;
  dryRun: boolean;
  maxIterations?: number;
  maxTokens?: number;
  maxTime?: number;
  allowedPaths?: string[];
  help: boolean;
}

/**
 * Parse command line arguments.
 */
function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  const result: CLIArgs = {
    task: '',
    preset: 'default',
    verbose: false,
    dryRun: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;

      case '-v':
      case '--verbose':
        result.verbose = true;
        break;

      case '-n':
      case '--dry-run':
        result.dryRun = true;
        break;

      case '-p':
      case '--preset':
        result.preset = args[++i] as keyof typeof ConfigPresets;
        break;

      case '--max-iterations':
        result.maxIterations = parseInt(args[++i], 10);
        break;

      case '--max-tokens':
        result.maxTokens = parseInt(args[++i], 10);
        break;

      case '--max-time':
        result.maxTime = parseInt(args[++i], 10);
        break;

      case '--allowed-paths':
        result.allowedPaths = args[++i].split(',');
        break;

      default:
        // Non-flag argument is the task
        if (!arg.startsWith('-')) {
          result.task = arg;
        }
    }

    i++;
  }

  return result;
}

/**
 * Print help message.
 */
function printHelp(): void {
  console.log(`
Production Agent CLI

Usage: npx ts-node run.ts [options] "task description"

Options:
  -h, --help              Show this help message
  -v, --verbose           Enable verbose output
  -n, --dry-run           Run without making changes (read-only mode)
  -p, --preset <name>     Use a configuration preset
                          (development, production, restricted, autonomous)
  --max-iterations <n>    Maximum iterations
  --max-tokens <n>        Maximum tokens
  --max-time <ms>         Maximum time in milliseconds
  --allowed-paths <paths> Comma-separated list of allowed paths

Examples:
  # Simple task
  npx ts-node run.ts "Create a hello world program"

  # Verbose mode
  npx ts-node run.ts -v "Analyze the codebase structure"

  # Dry run (no file changes)
  npx ts-node run.ts -n "Refactor the utils folder"

  # Production preset
  npx ts-node run.ts -p production "Deploy the application"

  # Custom limits
  npx ts-node run.ts --max-iterations 20 --max-time 60000 "Quick analysis"

Environment Variables:
  ANTHROPIC_API_KEY       API key for Anthropic
  AGENT_PRESET           Configuration preset name
  AGENT_MAX_TOKENS       Maximum tokens
  AGENT_MAX_ITERATIONS   Maximum iterations
  AGENT_MAX_TIME         Maximum time (ms)
  AGENT_SANDBOX_MODE     Enable sandbox mode (true/false)
  AGENT_LOG_LEVEL        Log level (debug, info, warn, error)
`);
}

// =============================================================================
// LLM Client
// =============================================================================

/**
 * Create a mock LLM client for demonstration.
 *
 * In production, this would connect to the actual API.
 */
function createMockClient(): LLMClient {
  return {
    chat: async (params: {
      model: string;
      messages: Message[];
      tools?: unknown[];
      maxTokens?: number;
    }): Promise<LLMResponse> => {
      // This is a mock - in production, call the real API
      console.log('[Mock LLM] Received request with', params.messages.length, 'messages');

      // Simulate thinking
      await new Promise(resolve => setTimeout(resolve, 100));

      // Return a simple response that calls done
      return {
        content: [
          {
            type: 'text',
            text: 'I understand the task. Let me complete it.',
          },
          {
            type: 'tool_use',
            name: 'done',
            input: {
              result: 'Task completed (mock response)',
              success: true,
            },
            id: 'mock-tool-call-1',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        stop_reason: 'tool_use',
      };
    },
  };
}

/**
 * Create a real Anthropic client.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */
function createAnthropicClient(): LLMClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    chat: async (params: {
      model: string;
      messages: Message[];
      tools?: unknown[];
      maxTokens?: number;
    }): Promise<LLMResponse> => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.maxTokens || 4096,
          messages: params.messages,
          tools: params.tools?.map((t: any) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} ${error}`);
      }

      return response.json() as Promise<LLMResponse>;
    },
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  // Show help
  if (args.help || !args.task) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  // Get configuration
  let config: Partial<AgentConfig> = {};

  if (args.preset !== 'default' && args.preset in ConfigPresets) {
    config = ConfigPresets[args.preset];
  }

  // Apply CLI overrides
  if (args.maxIterations) {
    config.budget = { ...config.budget, maxIterations: args.maxIterations } as any;
  }
  if (args.maxTokens) {
    config.budget = { ...config.budget, maxTokens: args.maxTokens } as any;
  }
  if (args.maxTime) {
    config.budget = { ...config.budget, maxTime: args.maxTime } as any;
  }
  if (args.allowedPaths) {
    config.safety = { ...config.safety, allowedPaths: args.allowedPaths } as any;
  }
  if (args.dryRun) {
    config.tools = { ...config.tools, fileTools: false, executeTools: false } as any;
  }
  if (args.verbose) {
    config.observability = { ...config.observability, logLevel: 'debug' } as any;
  }

  // Create client
  const client = createAnthropicClient() || createMockClient();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Info] ANTHROPIC_API_KEY not set, using mock client');
    console.log('[Info] Set ANTHROPIC_API_KEY to use the real API\n');
  }

  // Create agent
  const agent = createAgent(client, config);

  // Run
  console.log('='.repeat(60));
  console.log('Task:', args.task);
  console.log('Preset:', args.preset);
  console.log('Dry run:', args.dryRun);
  console.log('='.repeat(60));
  console.log();

  const result = await agent.run(args.task);

  // Output results
  console.log();
  console.log('='.repeat(60));
  console.log('Result');
  console.log('='.repeat(60));
  console.log();
  console.log('Success:', result.success);
  console.log('Result:', result.result);
  console.log();
  console.log('Metrics:');
  console.log('  Iterations:', result.metrics.iterations);
  console.log('  Tokens used:', result.metrics.tokensUsed);
  console.log('  Duration:', result.metrics.durationMs, 'ms');
  console.log('  Tool calls:', result.metrics.toolCalls);

  if (result.errors && result.errors.length > 0) {
    console.log();
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(' -', error);
    }
  }

  if (args.verbose) {
    console.log();
    console.log('Events:');
    for (const event of result.events) {
      console.log(' -', event.type, JSON.stringify(event).slice(0, 100));
    }
  }

  // Exit code
  process.exit(result.success ? 0 : 1);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

