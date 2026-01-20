/**
 * hello-world.ts - Simplest Possible Agent
 *
 * Derivation:
 * - Report 22: "The doing is simple. Observe. Generate. Check. Adjust. Repeat."
 *
 * This example shows the absolute minimum: an agent with no tools.
 * It's just a single LLM call in a loop that happens to exit immediately
 * because there are no tools to call.
 *
 * Run: npx ts-node examples/hello-world.ts
 */

import { runAgent } from '../minimal-agent';

async function main() {
  console.log('Running simplest possible agent...\n');

  const result = await runAgent(
    'What is 2 + 2? Reply with just the number.',
    [], // No tools - agent completes in one turn
    {
      maxIterations: 1,
      systemPrompt: 'You are a helpful assistant. Be concise.',
    }
  );

  console.log('Response:', result.response);
  console.log('Iterations:', result.iterations);
  console.log('Tokens used:', result.totalTokens);
}

main().catch(console.error);

/**
 * Expected output:
 *
 * Running simplest possible agent...
 *
 * Response: 4
 * Iterations: 1
 * Tokens used: { input: ~50, output: ~5 }
 *
 * This demonstrates that the "agent" is just a loop.
 * With no tools, it's equivalent to a single LLM call.
 * The loop is the primitive; everything else is optional.
 */
