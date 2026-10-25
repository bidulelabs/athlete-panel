import { z } from 'zod';
import semver from 'semver';

export const HOST_API_VERSION = '1.0.0';
const localPath=z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/).refine(v=>!v.split('/').some(s=>s==='.'||s==='..'),'Paths must stay inside the plugin directory.');
export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), name: z.string().min(1), description: z.string(),
  version: z.string().refine(v => !!semver.valid(v)), hostApi: z.string().refine(v => !!semver.validRange(v)),
  dependencies: z.record(z.string(), z.string()).default({}), optionalDependencies: z.record(z.string(), z.string()).default({}),
  required: z.boolean().default(false), client: localPath.optional(), server: localPath.optional(),
  routes: z.array(z.object({ path: z.string().regex(/^\/[a-z0-9/-]*$/), title: z.string(), icon: z.string().optional() })).default([]),
  slots:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9-]*$/),kind:z.enum(['calendar','inspector','dashboard','workspace']),title:z.string().min(1)})).default([]),
  schema: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(), migrations: z.array(localPath).default([]),
  services: z.array(z.string()).default([]), jobs: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]), configuration: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type PluginManifest = z.infer<typeof manifestSchema>;
export type CompositionEntry = { path: string; enabled: boolean; version: string };
export type Composition = { apiVersion: 1; plugins: CompositionEntry[] };

/** Validates the whole trusted composition before evaluating plugin entry points. */
export function validateComposition(manifests: PluginManifest[], enabledIds: string[]): PluginManifest[] {
  const all = new Map<string, PluginManifest>();
  for (const input of manifests) {
    const m = manifestSchema.parse(input);
    if (all.has(m.id)) throw new Error(`Duplicate plugin ID: ${m.id}`);
    if (!semver.satisfies(HOST_API_VERSION, m.hostApi)) throw new Error(`Incompatible host API: ${m.id}`);
    all.set(m.id, m);
  }
  const enabled = new Set(enabledIds);
  for (const id of enabled) if (!all.has(id)) throw new Error(`Unknown enabled plugin: ${id}`);
  const schemas = new Set<string>(['host']);
  const routes = new Set<string>(), visiting = new Set<string>(), visited = new Set<string>(), ordered: PluginManifest[] = [];
  const visit = (m: PluginManifest) => {
    if (visiting.has(m.id)) throw new Error(`Plugin dependency cycle: ${m.id}`);
    if (visited.has(m.id)) return;
    visiting.add(m.id);
    for (const [id, range] of Object.entries(m.dependencies)) {
      const dependency = all.get(id);
      if (!dependency || !enabled.has(id) || !semver.satisfies(dependency.version, range)) throw new Error(`Unsatisfied dependency ${m.id} → ${id} ${range}`);
      visit(dependency);
    }
    for (const [id, range] of Object.entries(m.optionalDependencies)) {
      const dependency = all.get(id);
      if (dependency && enabled.has(id) && !semver.satisfies(dependency.version, range)) throw new Error(`Incompatible optional dependency ${m.id} → ${id}`);
    }
    for (const route of m.routes) {
      if(['/','/login','/plugins'].includes(route.path)||route.path==='/api'||route.path.startsWith('/api/')) throw new Error(`Reserved host route: ${route.path}`);
      if (routes.has(route.path)) throw new Error(`Duplicate route: ${route.path}`);
      routes.add(route.path);
    }
    if(m.schema){if(schemas.has(m.schema))throw new Error(`Duplicate owned schema: ${m.schema}`);schemas.add(m.schema);}
    visiting.delete(m.id); visited.add(m.id); ordered.push(m);
  };
  for (const m of all.values()) {
    if (m.required && !enabled.has(m.id)) throw new Error(`Required plugin cannot be disabled: ${m.id}`);
    if (enabled.has(m.id)) visit(m);
  }
  return ordered;
}

export type OperationContext = { actor: 'owner' | 'agent'; grantId?: string };
export type ServerPlugin = { operations: Record<string, (body: unknown, context: OperationContext) => Promise<unknown>>; jobs?: Record<string,(job:any)=>Promise<void>>; schedule?:()=>Promise<void> };
