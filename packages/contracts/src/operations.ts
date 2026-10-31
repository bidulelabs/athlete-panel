import {
  proposalApplyInputSchema,
  proposalReviewInputSchema,
  proposalReviewSchema,
} from './proposal-review';
import { z } from 'zod';
import { importScopeSchema, importStreamSchema } from './import-recovery';
import {
  commandsSchema,
  dateSchema,
  agentGrantValuesSchema,
  agentConnectionIdSchema,
  agentConnectionApprovalSchema,
  agentConnectionStatusSchema,
} from './domain';
import { onboardingActionSchema, onboardingSchema } from './onboarding';
import {
  mutationResponseSchema,
  coveragePageSchema,
  grantSummarySchema,
  proposalSummarySchema,
} from './responses';
const id = z.object({ id: z.uuid() });
const undo = id.extend({ idempotencyKey: z.uuid() }).strict();
const ok = z.object({ ok: z.boolean() });
const operation = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({
  input,
  output,
});
export const operationContracts = {
  host: {
    plugins: operation(
      z.object({ id: z.string(), enabled: z.boolean() }).strict(),
      z.object({ pending: z.boolean(), message: z.string() }),
    ),
  },
  athlete: { onboarding: operation(onboardingActionSchema, onboardingSchema) },
  training: {
    mutate: operation(
      z.object({ commands: commandsSchema, idempotencyKey: z.uuid() }).strict(),
      mutationResponseSchema,
    ),
    undo: operation(undo, mutationResponseSchema),
  },
  garmin: {
    configure: operation(
      z
        .object({
          key: z.string().trim().min(8).max(4096),
          earliestDate: dateSchema.optional(),
          idempotencyKey: z.uuid().optional(),
        })
        .strict(),
      z.object({ connected: z.boolean() }),
    ),
    sync: operation(
      z
        .object({
          mode: z.enum(['recent', 'full']).default('recent'),
          from: dateSchema.nullable().optional(),
          to: dateSchema.optional(),
          stream: importStreamSchema.optional(),
          scope: importScopeSchema.optional(),
        })
        .strict(),
      z.object({ id: z.uuid(), status: z.string() }),
    ),
    pause: operation(z.object({ paused: z.boolean() }).strict(), z.object({ paused: z.boolean() })),
    disconnect: operation(z.object({}).optional(), z.object({ connected: z.boolean() })),
    coverage: operation(
      z
        .object({
          filter: z.enum(['all', 'failed', 'unavailable', 'rejected', 'unscanned']).default('all'),
          offset: z.number().int().min(0).max(1000000).default(0),
        })
        .strict(),
      coveragePageSchema,
    ),
  },
  'agent-bridge': {
    details: operation(id, proposalSummarySchema),
    grant: operation(
      agentGrantValuesSchema,
      z.object({ grant: grantSummarySchema, token: z.string() }),
    ),
    revoke: operation(id, ok),
    reject: operation(id, ok),
    undo: operation(undo, mutationResponseSchema),
    review: operation(proposalReviewInputSchema, proposalReviewSchema),
    apply: operation(
      proposalApplyInputSchema,
      mutationResponseSchema.extend({ proposalId: z.uuid() }),
    ),
    connection: operation(agentConnectionIdSchema, agentConnectionStatusSchema),
    'approve-connection': operation(agentConnectionApprovalSchema, agentConnectionStatusSchema),
    'deny-connection': operation(agentConnectionIdSchema, agentConnectionStatusSchema),
  },
} as const;
type Contracts = typeof operationContracts;
type Contract<P extends string, O extends string> = P extends keyof Contracts
  ? O extends keyof Contracts[P]
    ? Contracts[P][O]
    : never
  : never;
export type OperationInput<P extends string, O extends string> = P extends keyof Contracts
  ? Contract<P, O> extends { input: infer S extends z.ZodType }
    ? z.input<S>
    : never
  : unknown;
export type OperationOutput<P extends string, O extends string> = P extends keyof Contracts
  ? Contract<P, O> extends { output: infer S extends z.ZodType }
    ? z.output<S>
    : never
  : unknown;
export type PluginRequest = <P extends string, O extends string>(
  pluginId: P,
  operation: O,
  ...args: undefined extends OperationInput<P, O>
    ? [body?: OperationInput<P, O>]
    : [body: OperationInput<P, O>]
) => Promise<OperationOutput<P, O>>;
export function operationContract(
  pluginId: string,
  name: string,
): { input: z.ZodType; output: z.ZodType } | undefined {
  const plugins: Record<
    string,
    Record<string, { input: z.ZodType; output: z.ZodType }>
  > = operationContracts;
  return Object.hasOwn(plugins, pluginId) && Object.hasOwn(plugins[pluginId] ?? {}, name)
    ? plugins[pluginId]?.[name]
    : undefined;
}
/** One checked facade: unknown extension results stay unknown; built-in responses are parsed. */
export function createPluginRequester(
  transport: (pluginId: string, operation: string, body: unknown) => Promise<unknown>,
): PluginRequest {
  return (async (pluginId: string, name: string, body: unknown = {}) => {
    const contract = operationContract(pluginId, name);
    const result = await transport(pluginId, name, contract ? contract.input.parse(body) : body);
    return contract ? contract.output.parse(result) : result;
  }) as PluginRequest;
}
