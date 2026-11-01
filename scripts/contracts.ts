import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import {
  workspaceEnvelopeSchema,
  onboardingStatusSchema,
  operationContracts,
  commandsSchema,
  agentCommandsSchema,
  workspaceStateSchema,
  agentGrantValuesSchema,
  agentConnectionStartSchema,
  agentConnectionApprovalSchema,
  agentConnectionStatusSchema,
  historyQuerySchema,
  historyResponseSchema,
} from '../packages/contracts/src';
import { onboardingSchema, onboardingActionSchema } from '../packages/contracts/src/onboarding';
import { manifestSchema } from '../packages/plugin-sdk/src';
const output =
  JSON.stringify(
    {
      version: 1,
      responses: {
        workspace: z.toJSONSchema(workspaceEnvelopeSchema, { unrepresentable: 'any' }),
        onboarding: z.toJSONSchema(onboardingStatusSchema, { unrepresentable: 'any' }),
      },
      operations: Object.fromEntries(
        Object.entries(operationContracts).map(([plugin, operations]) => [
          plugin,
          Object.fromEntries(
            Object.entries(operations).map(([name, contract]) => [
              name,
              {
                input: z.toJSONSchema(contract.input, { unrepresentable: 'any' }),
                output: z.toJSONSchema(contract.output, { unrepresentable: 'any' }),
              },
            ]),
          ),
        ]),
      ),
      note: 'Generated from runtime schemas. Custom refinements additionally apply at runtime.',
      onboarding: {
        state: z.toJSONSchema(onboardingSchema),
        action: z.toJSONSchema(onboardingActionSchema, { unrepresentable: 'any' }),
      },
      commands: z.toJSONSchema(commandsSchema, { unrepresentable: 'any' }),
      agentCommands: z.toJSONSchema(agentCommandsSchema, { unrepresentable: 'any' }),
      workspace: z.toJSONSchema(workspaceStateSchema, { unrepresentable: 'any' }),
      plugin: z.toJSONSchema(manifestSchema, { unrepresentable: 'any' }),
      agentGrant: z.toJSONSchema(agentGrantValuesSchema, { unrepresentable: 'any' }),
      history: {
        request: z.toJSONSchema(historyQuerySchema),
        response: z.toJSONSchema(historyResponseSchema, { unrepresentable: 'any' }),
      },
      agentConnection: {
        start: z.toJSONSchema(agentConnectionStartSchema),
        approve: z.toJSONSchema(agentConnectionApprovalSchema, { unrepresentable: 'any' }),
        status: z.toJSONSchema(agentConnectionStatusSchema, { unrepresentable: 'any' }),
      },
    },
    null,
    2,
  ) + '\n';
const file = 'docs/reference/contracts.json';
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8').catch(() => '')) !== output)
    throw new Error('Generated contract reference is stale.');
} else {
  await mkdir('docs/reference', { recursive: true });
  await writeFile(file, output);
}
