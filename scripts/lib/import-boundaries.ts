import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import semver from 'semver';
import {
  manifestSchema,
  validateComposition,
  type PluginManifest,
} from '../../packages/plugin-sdk/src';

type Edge = { specifier: string; target?: string; typeOnly: boolean; external: boolean };
type Module = { edges: Edge[]; client: boolean; server: boolean };
type Plugin = { directory: string; manifest: PluginManifest; enabled: boolean };
const within = (file: string, directory: string) =>
  file === directory || file.startsWith(directory + sep);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

/** Resolve source edges using the same aliases/options as tsc; never evaluate plugin code. */
export function checkBoundaries(root: string): string[] {
  root = realpathSync(root);
  const loaded = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (loaded.error)
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
  if (config.errors.length)
    throw new Error(ts.flattenDiagnosticMessageText(config.errors[0]!.messageText, '\n'));
  const composition = JSON.parse(
    readFileSync(resolve(root, 'instance/composition.json'), 'utf8'),
  ) as { plugins: { path: string; enabled: boolean; version: string }[] };
  const plugins: Plugin[] = composition.plugins.map((entry) => {
    const directory = resolve(root, entry.path);
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')),
    );
    if (manifest.version !== entry.version) throw new Error(`Version pin mismatch: ${manifest.id}`);
    return { directory, manifest, enabled: entry.enabled };
  });
  validateComposition(
    plugins.map((p) => p.manifest),
    plugins.filter((p) => p.enabled).map((p) => p.manifest.id),
  );
  const errors = new Set<string>();
  const modules = new Map<string, Module>();
  const owner = (file: string) => plugins.find((p) => within(file, p.directory));
  const label = (file: string) => relative(root, file);
  const publicPaths = (plugin: Plugin) =>
    Object.values(plugin.manifest.public).map((p) => resolve(plugin.directory, p));
  const serverRoots = new Set(
    plugins.flatMap((p) =>
      [p.manifest.server, p.manifest.public.server]
        .filter((v): v is string => !!v)
        .map((v) => resolve(p.directory, v)),
    ),
  );
  for (const plugin of plugins)
    for (const entry of [
      plugin.manifest.client,
      plugin.manifest.server,
      ...Object.values(plugin.manifest.public),
    ]) {
      if (entry && !existsSync(resolve(plugin.directory, entry)))
        errors.add(`${plugin.manifest.id}: missing entry ${entry}`);
    }
  const inspect = (file: string): Module | undefined => {
    if (modules.has(file)) return modules.get(file);
    if (!/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts')) return;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const directives = source.statements
      .filter(ts.isExpressionStatement)
      .map((s) => (ts.isStringLiteral(s.expression) ? s.expression.text : ''));
    const module: Module = {
      edges: [],
      client: directives.includes('use client'),
      server: directives.includes('use server'),
    };
    modules.set(file, module);
    const add = (value: ts.Node | undefined, typeOnly: boolean) => {
      const specifier =
        value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
          ? value.text
          : '<computed module>';
      const resolved = ts.resolveModuleName(specifier, file, config.options, ts.sys).resolvedModule;
      const asset = specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined;
      const target = resolved
        ? realpathSync(resolved.resolvedFileName)
        : asset && existsSync(asset)
          ? realpathSync(asset)
          : undefined;
      const external =
        !!resolved?.isExternalLibraryImport && !!target?.includes(`${sep}node_modules${sep}`);
      module.edges.push({ specifier, target, typeOnly, external });
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause,
          bindings = clause?.namedBindings;
        add(
          node.moduleSpecifier,
          !!clause?.isTypeOnly ||
            !!(
              clause &&
              !clause.name &&
              bindings &&
              ts.isNamedImports(bindings) &&
              bindings.elements.length &&
              bindings.elements.every((e) => e.isTypeOnly)
            ),
        );
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        add(
          node.moduleSpecifier,
          node.isTypeOnly ||
            !!(
              node.exportClause &&
              ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.length &&
              node.exportClause.elements.every((e) => e.isTypeOnly)
            ),
        );
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        add(node.arguments[0], false);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        add(node.moduleReference.expression, node.isTypeOnly);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        add(node.argument.literal, true);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const edge of module.edges) if (edge.target && !edge.external) inspect(edge.target);
    return module;
  };
  for (const file of config.fileNames) inspect(realpathSync(file));
  for (const plugin of plugins)
    for (const entry of [plugin.manifest.client, ...Object.values(plugin.manifest.public)]) {
      if (entry && existsSync(resolve(plugin.directory, entry)))
        inspect(realpathSync(resolve(plugin.directory, entry)));
    }
  for (const [file, module] of modules) {
    const from = owner(file);
    if (!from) continue;
    for (const edge of module.edges) {
      if (!edge.target || edge.external) continue;
      const to = owner(edge.target);
      if (
        !to &&
        !within(edge.target, resolve(root, 'packages')) &&
        !within(edge.target, resolve(root, 'instance'))
      ) {
        errors.add(
          `${label(file)}: plugin bypasses public infrastructure through ${edge.specifier}`,
        );
      }
      if (to && to !== from) {
        if (!publicPaths(to).includes(edge.target))
          errors.add(`${label(file)}: private plugin import ${edge.specifier}`);
        // Imported source is required even for a type-only edge; optional features use contributions.
        const range = from.manifest.dependencies[to.manifest.id];
        if (!range || !semver.satisfies(to.manifest.version, range))
          errors.add(
            `${label(file)}: undeclared/incompatible dependency ${from.manifest.id} → ${to.manifest.id}`,
          );
      }
      if (
        within(from.directory, resolve(root, 'personal-plugins')) &&
        (within(edge.target, resolve(root, 'packages/host')) ||
          within(edge.target, resolve(root, 'instance')))
      )
        errors.add(`${label(file)}: personal plugin bypasses public services`);
    }
  }
  const browserRoots = new Set([...modules].filter(([, m]) => m.client).map(([file]) => file));
  for (const plugin of plugins)
    for (const entry of [
      plugin.manifest.client,
      plugin.manifest.public.client,
      plugin.manifest.public.shared,
    ])
      if (entry) browserRoots.add(resolve(plugin.directory, entry));
  const generatedClient = resolve(root, 'instance/registry.client.ts');
  if (modules.has(generatedClient)) browserRoots.add(generatedClient);
  const foundationRoots = [...modules.keys()].filter((file) =>
    within(file, resolve(root, 'packages')),
  );
  const walk = (start: string, browser: boolean) => {
    const seen = new Set<string>();
    const visit = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const edge of modules.get(file)?.edges ?? []) {
        if (edge.typeOnly && browser) continue;
        const path = [...chain, edge.target ? label(edge.target) : edge.specifier];
        const serverImport =
          edge.specifier.startsWith('node:') ||
          builtins.has(edge.specifier) ||
          /^(server-only|postgres|drizzle-orm|next\/(headers|server))(\/|$)/.test(edge.specifier);
        const serverTarget =
          edge.target &&
          (within(edge.target, resolve(root, 'packages/host')) ||
            serverRoots.has(edge.target) ||
            modules.get(edge.target)?.server ||
            /(?:\.server|\/registry\.server)\.[cm]?[jt]sx?$/.test(edge.target));
        if (browser && (serverImport || serverTarget || !edge.target))
          errors.add(`Browser dependency: ${path.join(' → ')}`);
        else if (!browser && edge.target && owner(edge.target)) {
          const area = within(start, resolve(root, 'packages/host')) ? 'Host' : 'Shared package';
          errors.add(`${area} imports feature code: ${path.join(' → ')}`);
        } else if (edge.target && !edge.external) visit(edge.target, path);
      }
    };
    visit(start, [label(start)]);
  };
  for (const file of browserRoots) walk(file, true);
  for (const file of foundationRoots) walk(file, false);
  return [...errors].sort();
}
