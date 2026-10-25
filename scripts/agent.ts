import { runAgentCli } from './lib/agent-client';

try {
  await runAgentCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The agent command failed.');
  process.exitCode = 1;
}
