import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { config } from '../config.js';
import { contentHash } from '../files.js';
import { ecosystemRegistry } from '../ecosystems/index.js';
import {
  languageRegistry,
  sourceLanguage,
  type SourceLanguage,
  type LanguageProjectFacts,
} from '../languages/index.js';
export { sourceLanguage, collectedFacts } from '../languages/index.js';
export type { SourceLanguage, ModuleFact } from '../languages/index.js';
export { pythonProjectRoots } from '../ecosystems/index.js';

export interface ProjectFileRecord {
  path: string;
  kind: 'source' | 'test' | 'config' | 'schema' | 'migration' | 'documentation' | 'other';
  bytes: number;
}

export interface ModuleRecord {
  path: string;
  contentHash: string;
  imports: string[];
  importedSymbols: string[];
  exports: string[];
  calls: string[];
  resolvedImports: string[];
  resolvedImportMap?: Record<string, string> | undefined;
  /** Specifiers that look local by the language's static rules but resolve to no project file. */
  unresolvedImports?: string[] | undefined;
  /** 1-based line of the first import, re-export, or dynamic import of each module specifier. */
  importLines?: Record<string, number> | undefined;
  dynamicImports: string[];
  declarations: {
    classes: number;
    functions: number;
    interfaces: number;
    types: number;
    variables: number;
  };
  directives: string[];
  /** Opaque parser facts, interpreted only by the owning language backend. */
  parseFacts?: unknown;
  /** Up to 5 lines with syntax error nodes. Informational; never produces findings (D3). */
  parseDiagnostics?: number[] | undefined;
  /** Canonical source names supplied by the owning backend for relative import spellings. */
  canonicalImports?: Record<string, string> | undefined;
}

export interface CapabilitySignal {
  status: 'observed' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
  packages: string[];
  files: string[];
  imports: string[];
  evidence: string[];
}

export interface ProjectModel {
  version: 1;
  project: {
    name?: string | undefined;
    packageManager?: string | undefined;
    frameworks: string[];
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    workspacePackages: {
      path: string;
      name?: string | undefined;
      private: boolean;
      scripts: Record<string, string>;
      dependencies: string[];
      exports?: string[] | undefined;
      projectReferences?: string[] | undefined;
    }[];
  };
  files: ProjectFileRecord[];
  modules: ModuleRecord[];
  configs: string[];
  schemas: string[];
  tests: {
    files: string[];
    scripts: Record<string, string>;
  };
  git: {
    repository: boolean;
    branch?: string | undefined;
    dirty: boolean;
    changedFiles: string[];
    status: string[];
    diffStat: string;
    history: { hash: string; date: string; subject: string }[];
  };
  patterns: {
    clientComponents: string[];
    serverActions: string[];
    routeHandlers: string[];
    routeDetails: { path: string; methods: string[] }[];
    barrelFiles: string[];
    importGraphEdges: number;
  };
  capabilities: Record<string, CapabilitySignal>;
  insights: {
    layers: Record<string, string[]>;
    cycles: string[][];
    importHotspots: { module: string; count: number }[];
    boundaries: { kind: string; files: string[]; evidence: string }[];
    layerEdges: { from: string; to: string; count: number }[];
    dependencyEdges: { from: string; to: string }[];
    envReferences: { name: string; files: string[]; declared: boolean }[];
    impactPaths: {
      entrypoint: string;
      files: string[];
      layers: string[];
      boundaries: string[];
    }[];
    /** Import resolution per language. Absent in models persisted before it was recorded. */
    importResolution?: ImportResolutionSummary[] | undefined;
  };
}

/**
 * Import resolution counts for the modules of one language (D16). Counts cover the static imports
 * discovery records, so a module with no unresolved imports is complete within the supported
 * static subset, not at runtime.
 */
export interface ImportResolutionSummary {
  language: SourceLanguage;
  modules: number;
  imports: number;
  resolved: number;
  unresolved: number;
  external: number;
  /** Modules with parser error nodes, which may hide imports (D3). */
  modulesWithParseDiagnostics: number;
}

export interface DiscoveryMetrics {
  durationMs: number;
  files: number;
  modules: number;
  cacheAvailable: boolean;
  cacheHit: boolean;
  changedFiles: number;
  reusedModules: number;
}

export interface DiscoveryResult {
  model: ProjectModel;
  metrics: DiscoveryMetrics;
}

export interface DiscoveryOptions {
  persistCache?: boolean | undefined;
  /** Maximum number of files included in one model. */
  maxFiles?: number | undefined;
  /** Maximum size of one included file in bytes. */
  maxFileBytes?: number | undefined;
}

export class DiscoveryLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryLimitError';
  }
}

export class DiscoveryStaleError extends Error {
  constructor() {
    super('Project changed while Guard was discovering it.');
    this.name = 'DiscoveryStaleError';
  }
}

const DEFAULT_MAX_FILES = 100_000;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  '.codapult',
  'certificates',
]);
function ignoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || ecosystemRegistry.ignoredDirectory(name);
}
const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);

const discoveryCache = new Map<
  string,
  { signature: string; resolutionFingerprint: string; model: ProjectModel }
>();
const discoveryReuse = new Map<string, number>();
const discoveryCacheHits = new Map<string, boolean>();
// Bump when the persisted model shape changes; old cache entries must never
// bypass discovery and return an incomplete ProjectModel.
const DISCOVERY_CACHE_VERSION = 9;

function discoveryCachePath(root: string): string {
  return resolve(root, `.${config.appName}/guard/cache.json`);
}

function canPersistDiscoveryCache(root: string): boolean {
  const parent = resolve(root, `.${config.appName}`);
  const directory = dirname(discoveryCachePath(root));
  for (const path of [parent, directory]) {
    if (!existsSync(path)) continue;
    try {
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function clearDiscoveryCache(root: string): void {
  rmSync(discoveryCachePath(root), { force: true });
}

/** Hash both backend and ecosystem resolution inputs; source contents are parsed separately. */
function resolutionFingerprint(root: string, allFiles: string[]): string {
  const hash = createHash('sha256');
  for (const path of [...allFiles].sort()) {
    const inputs = [
      languageRegistry.resolutionInput(path),
      ecosystemRegistry.resolutionInput(path),
    ];
    if (!inputs.some(Boolean)) continue;
    hash.update(`${path}\0${inputs.includes('content') ? contentHash(root, path) : ''}\n`);
  }
  return hash.digest('hex');
}

function ignoredFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    (name.startsWith('.env.') && name !== '.env.example') ||
    name === '.env' ||
    /\.(?:db|sqlite|sqlite3|tsbuildinfo|pem|key|p12|pfx|pyc|pyo)$/.test(name)
  );
}

export function findGuardRoot(from: string = process.cwd()): string {
  let directory = resolve(from);
  const filesystemRoot = resolve('/');
  while (directory !== filesystemRoot) {
    if (
      existsSync(resolve(directory, '.git')) ||
      ecosystemRegistry.rootMarkers.some((marker) => existsSync(resolve(directory, marker)))
    ) {
      return directory;
    }
    directory = dirname(directory);
  }
  return resolve(from);
}

function listFiles(root: string, directory = root, maxFiles = DEFAULT_MAX_FILES): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectory(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, path, maxFiles - result.length));
    else if (entry.isFile() && !ignoredFile(path)) {
      result.push(relative(root, path));
      if (result.length > maxFiles) {
        throw new DiscoveryLimitError(
          `Project contains more than ${maxFiles} files; discovery limit was reached. ` +
            'Use an ignore file or raise maxFiles deliberately.',
        );
      }
    }
  }
  return result.sort();
}

function fileKind(path: string): ProjectFileRecord['kind'] {
  const backend = languageRegistry.forPath(path);
  if (backend) return backend.classifyFile(path);
  const name = basename(path).toLowerCase();
  if (/\.(?:test|spec)\.[^.]+$/.test(name) || path.includes('/__tests__/')) return 'test';
  if (name.includes('schema') || path.includes('/schemas/')) return 'schema';
  if (path.includes('/migrations/') || path.includes('/drizzle/')) return 'migration';
  if (ecosystemRegistry.isConfigFile(path)) return 'config';
  if (DOCUMENTATION_EXTENSIONS.has(extname(name))) return 'documentation';
  if (name.includes('config')) return 'config';
  return 'other';
}

export type ImportResolutionStatus = 'resolved' | 'unresolved' | 'external';

/**
 * Resolution status of one import specifier of a module.
 *
 * `resolved` means the specifier resolves to a project file, which may be a non-module file such
 * as a stylesheet. JS/TS relative specifiers are always either resolved or listed as unresolved,
 * because the path fallback resolves them when the parser does not. A Python `from X import n`
 * spelling is resolved when every name resolved as a submodule, since `X` itself is not needed. `external` means outside the module graph by static rules; it
 * does not mean the package is installed.
 */
export function importResolutionStatus(
  module: ModuleRecord,
  specifier: string,
): ImportResolutionStatus {
  if (module.resolvedImportMap?.[specifier] !== undefined) return 'resolved';
  if (module.unresolvedImports?.includes(specifier)) return 'unresolved';
  return languageRegistry.forPath(module.path)?.importStatus(module, specifier) ?? 'external';
}

/** Unique import specifiers of a module: static imports, re-exports, and literal dynamic imports. */
export function moduleImportSpecifiers(module: ModuleRecord): string[] {
  return [...new Set([...module.imports, ...module.exports, ...module.dynamicImports])];
}

/** Import resolution summary per language, sorted by language. */
export function summarizeImportResolution(
  modules: readonly ModuleRecord[],
): ImportResolutionSummary[] {
  const summaries = new Map<SourceLanguage, ImportResolutionSummary>();
  for (const module of modules) {
    const language = sourceLanguage(module.path);
    if (!language) continue;
    const summary = summaries.get(language) ?? {
      language,
      modules: 0,
      imports: 0,
      resolved: 0,
      unresolved: 0,
      external: 0,
      modulesWithParseDiagnostics: 0,
    };
    summary.modules += 1;
    if ((module.parseDiagnostics?.length ?? 0) > 0) summary.modulesWithParseDiagnostics += 1;
    for (const specifier of moduleImportSpecifiers(module)) {
      summary.imports += 1;
      summary[importResolutionStatus(module, specifier)] += 1;
    }
    summaries.set(language, summary);
  }
  return [...summaries.values()].sort((left, right) => left.language.localeCompare(right.language));
}

function runGit(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  } catch (error) {
    const stdout = (error as { stdout?: Buffer | undefined }).stdout;
    return stdout?.toString().trim() || undefined;
  }
}

function discoverySignature(root: string, allFiles: string[]): string {
  return JSON.stringify([
    ...ecosystemRegistry.signatureInputs({ root, allFiles }),
    allFiles.map((path) => {
      const stat = statSync(resolve(root, path));
      return [path, stat.size, stat.mtimeMs, contentHash(root, path)];
    }),
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(root, ['status', '--porcelain']),
  ]);
}

function gitModel(root: string): ProjectModel['git'] {
  const branch = runGit(root, ['branch', '--show-current']);
  const status = runGit(root, ['status', '--porcelain'])?.split('\n').filter(Boolean) ?? [];
  const changed = new Set<string>([
    ...(runGit(root, ['diff', '--name-only', 'HEAD'])?.split('\n').filter(Boolean) ?? []),
    ...(runGit(root, ['ls-files', '--others', '--exclude-standard'])?.split('\n').filter(Boolean) ??
      []),
  ]);
  const history = (
    runGit(root, ['log', '-n', '30', '--date=iso-strict', '--format=%H%x1f%ad%x1f%s']) ?? ''
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', date = '', subject = ''] = line.split('\x1f');
      return { hash, date, subject };
    });
  return {
    repository: runGit(root, ['rev-parse', '--is-inside-work-tree']) === 'true',
    ...(branch ? { branch } : {}),
    dirty: status.length > 0,
    changedFiles: [...changed].sort(),
    status,
    diffStat: runGit(root, ['diff', '--stat', 'HEAD']) ?? '',
    history,
  };
}

function inferFrameworks(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): string[] {
  const all = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);
  const known: readonly (readonly [string, string])[] = [
    ['next', 'Next.js'],
    ['react', 'React'],
    ['vue', 'Vue'],
    ['svelte', 'Svelte'],
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['@nestjs/core', 'NestJS'],
    ['drizzle-orm', 'Drizzle'],
    ['prisma', 'Prisma'],
  ] as const;
  const frameworks = known.filter(([dependency]) => all.has(dependency)).map(([, name]) => name);
  if (all.has('vite') && !all.has('next')) frameworks.push('Vite');
  return frameworks;
}

function layerForPath(path: string): string {
  const segments = path.toLowerCase().split('/');
  if (segments.includes('__tests__') || /\.(?:test|spec)\./.test(path)) return 'tests';
  if (languageRegistry.forPath(path)?.isTestFile(path)) return 'tests';
  if (segments.some((segment) => languageRegistry.routeLayerSegments(path).includes(segment)))
    return 'routes';
  if (segments.includes('components') || segments.includes('ui')) return 'ui';
  if (segments.some((segment) => ['domain', 'entities', 'models'].includes(segment))) {
    return 'domain';
  }
  if (
    segments.some((segment) =>
      ['services', 'use-cases', 'usecases', 'application'].includes(segment),
    )
  ) {
    return 'application';
  }
  if (
    segments.some((segment) =>
      ['db', 'database', 'repositories', 'adapters', 'infrastructure', 'lib'].includes(segment),
    )
  ) {
    return 'infrastructure';
  }
  if (segments.some((segment) => ['config', 'configs', 'configuration'].includes(segment))) {
    return 'config';
  }
  return 'other';
}

/** Build the internal module graph from AST resolution plus conservative fallback resolution.
 *
 * TypeScript resolution is authoritative when available, but it is not complete for every
 * JavaScript/configuration shape. The fallback must be additive: using it only when there are
 * no resolved imports silently drops unresolved edges from mixed projects. The fallback applies
 * JS/TS relative-path rules, so other languages rely on their own resolved imports only.
 */
export function buildModuleTargetGraph(modules: ModuleRecord[]): Map<string, string[]> {
  const moduleSet = new Set(modules.map((candidate) => candidate.path));
  return new Map(
    modules.map((module) => {
      const targets = new Set(module.resolvedImports.filter((path) => moduleSet.has(path)));
      for (const target of languageRegistry
        .forPath(module.path)
        ?.fallbackTargets(module, moduleSet) ?? [])
        targets.add(target);
      return [module.path, [...targets].sort()] as const;
    }),
  );
}

function findCycles(modules: ModuleRecord[]): string[][] {
  const graph = buildModuleTargetGraph(modules);
  const indexByNode = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;
  const visit = (node: string): void => {
    indexByNode.set(node, index);
    lowLink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!indexByNode.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, indexByNode.get(next) ?? 0));
      }
    }
    if (lowLink.get(node) !== indexByNode.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== node);
    if (component.length > 1 || (component.length === 1 && graph.get(node)?.includes(node))) {
      components.push(component.sort());
    }
  };
  for (const module of modules) {
    if (!indexByNode.has(module.path)) visit(module.path);
  }
  return components.sort((a, b) => a.join().localeCompare(b.join()));
}

function buildImpactPaths(
  modules: ModuleRecord[],
  routeHandlers: string[],
  serverActions: string[],
): ProjectModel['insights']['impactPaths'] {
  const moduleByPath = new Map(modules.map((module) => [module.path, module]));
  const graph = buildModuleTargetGraph(modules);
  const entrypoints = [...new Set([...routeHandlers, ...serverActions])]
    .filter((path) => moduleByPath.has(path))
    .sort()
    .slice(0, 200);
  return entrypoints.map((entrypoint) => {
    const queue = [entrypoint];
    const visited = new Set<string>();
    while (queue.length > 0 && visited.size < 200) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      const module = moduleByPath.get(current);
      if (!module) continue;
      for (const target of graph.get(module.path) ?? []) {
        if (!visited.has(target) && moduleByPath.has(target)) queue.push(target);
      }
    }
    const files = [...visited].sort();
    const layers = [...new Set(files.map(layerForPath))];
    const boundaries = [
      ...new Set(
        files.flatMap((file) => {
          const module = moduleByPath.get(file);
          return (
            module?.directives.filter(
              (directive) => directive === 'use client' || directive === 'use server',
            ) ?? []
          );
        }),
      ),
    ].sort();
    return { entrypoint, files, layers, boundaries };
  });
}

function detectCapabilities(
  files: ProjectFileRecord[],
  modules: ModuleRecord[],
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  scripts: Record<string, string>,
): Record<string, CapabilitySignal> {
  const allPackages = Object.keys({ ...dependencies, ...devDependencies });
  const evidenceFiles = files
    .filter((file) => file.kind !== 'documentation')
    .map((file) => file.path);
  const allImports = [...new Set(modules.flatMap((module) => module.imports))].sort();
  const packageSignal = (
    packagePattern: RegExp,
    filePattern: RegExp,
    importPattern: RegExp,
    evidence: string,
  ): CapabilitySignal => {
    const packages = allPackages.filter((name) => packagePattern.test(name));
    const matchedFiles = evidenceFiles.filter((file) => filePattern.test(file));
    const imports = allImports.filter((importPath) => importPattern.test(importPath));
    return {
      status: matchedFiles.length > 0 || imports.length > 0 ? 'observed' : 'inferred',
      confidence:
        packages.length > 0 && (matchedFiles.length > 0 || imports.length > 0)
          ? 'high'
          : packages.length > 0 || matchedFiles.length > 0 || imports.length > 0
            ? 'medium'
            : 'low',
      packages,
      files: matchedFiles,
      imports,
      evidence: [
        ...(packages.length > 0 ? [`dependency: ${packages.join(', ')}`] : []),
        ...(matchedFiles.length > 0 ? [`file pattern: ${filePattern.source}`] : []),
        ...(imports.length > 0 ? [`import pattern: ${importPattern.source}`] : []),
        ...(packages.length > 0 || matchedFiles.length > 0 || imports.length > 0 ? [evidence] : []),
      ],
    };
  };

  const capabilities: Record<string, CapabilitySignal> = {
    runtime: {
      status: 'observed',
      confidence: 'high',
      packages: allPackages.filter((name) =>
        /^(next|react|vue|svelte|express|fastify|@nestjs\/core)$/.test(name),
      ),
      files: files.filter((file) => file.kind === 'config').map((file) => file.path),
      imports: allImports.filter((importPath) =>
        /^(next|react|vue|svelte|express|fastify)(\/|$)/.test(importPath),
      ),
      evidence: ['package metadata and runtime imports'],
    },
    routing: packageSignal(
      /^next$/,
      /(?:^|\/)(?:route|page)\.[cm]?[jt]sx?$/,
      /^(next\/navigation|next\/server|next\/headers)$/,
      'route and page conventions',
    ),
    'server-client-boundaries': {
      status: 'observed',
      confidence: 'high',
      packages: [],
      files: modules
        .filter((module) =>
          module.directives.some(
            (directive) => directive === 'use client' || directive === 'use server',
          ),
        )
        .map((module) => module.path),
      imports: [],
      evidence: ['use client/use server directives'],
    },
    persistence: packageSignal(
      /^(?:drizzle-orm|drizzle-kit|prisma|@prisma\/client|typeorm|sequelize|mongoose|knex|@libsql\/client)$/,
      /(?:^|\/)(?:db|database|repositories|schema|schemas|migrations|drizzle)(?:\/|[^/]*$)/i,
      /^(?:@prisma\/client|prisma|drizzle-orm|drizzle-kit|typeorm|sequelize|mongoose|knex|@libsql\/client)(\/|$)|(?:^|\/)(?:db|database)(\/|$)/i,
      'database and ORM conventions',
    ),
    identity: packageSignal(
      /auth|identity|session|kinde|clerk|lucia|next-auth|better-auth/i,
      /(?:^|\/)(?:auth|authentication|identity|session)(?:\/|[^/]*$)/i,
      /(?:^|\/)(?:auth|authentication|identity|session)(?:\/|$)/i,
      'identity and session conventions',
    ),
    payments: packageSignal(
      /stripe|lemonsqueezy|paddle|paypal|braintree|polar/i,
      /(?:^|\/)(?:billing|payment|payments|checkout|subscription|subscriptions)(?:\/|[^/]*$)/i,
      /stripe|lemonsqueezy|paddle|paypal|braintree|polar/i,
      'payment provider conventions',
    ),
    email: packageSignal(
      /resend|react-email|nodemailer|postmark|sendgrid|mailgun/i,
      /(?:^|\/)(?:email|emails|mail|templates)(?:\/|[^/]*$)/i,
      /resend|react-email|nodemailer|postmark|sendgrid|mailgun/i,
      'email delivery and template conventions',
    ),
    ai: packageSignal(
      /^(?:ai|openai|anthropic|@ai-sdk\/|@langchain\/)/i,
      /(?:^|\/)(?:ai|agents|prompts|embeddings|rag|llm)(?:\/|[^/]*$)/i,
      /^(?:ai|openai|anthropic|@ai-sdk\/|@langchain\/)/i,
      'AI and model integration conventions',
    ),
    jobs: packageSignal(
      /bullmq|agenda|inngest|trigger\.dev|@temporalio|graphile-worker|bee-queue|pg-boss/i,
      /(?:^|\/)(?:jobs|queues|queue|workers|worker|background|tasks)(?:\/|[^/]*$)/i,
      /bullmq|agenda|inngest|trigger\.dev|@temporalio|graphile-worker|bee-queue|pg-boss/i,
      'background job and queue conventions',
    ),
    env: packageSignal(
      /dotenv|envalid|convex|@t3-oss\/env/i,
      /(?:^|\/)(?:env|environment)(?:\/|[^/]*$)|(?:^|\/)\.env(?:\.example)?$|(?:^|\/)(?:config|configuration)\/env(?:[^/]*)$/i,
      /dotenv|envalid|@t3-oss\/env/i,
      'environment and configuration conventions',
    ),
    deployment: packageSignal(
      /vercel|docker|pulumi|terraform|kubernetes|helm|aws-sdk|@aws-sdk\//i,
      /(?:^|\/)(?:Dockerfile|docker-compose|infra|terraform|pulumi|helm|k8s|\.github\/workflows)(?:\/|[^/]*$)/i,
      /vercel|pulumi|terraform|kubernetes|helm|aws-sdk|@aws-sdk\//i,
      'deployment and infrastructure conventions',
    ),
    testing: packageSignal(
      /vitest|jest|playwright|cypress|mocha|ava/i,
      /(?:^|\/)(?:__tests__|tests?|e2e)(?:\/|[^/]*$)|\.(?:test|spec)\./i,
      /vitest|jest|playwright|cypress|mocha|ava/i,
      'test runner and test layout conventions',
    ),
    observability: packageSignal(
      /sentry|opentelemetry|datadog|pino|winston|otel/i,
      /(?:^|\/)(?:instrumentation|observability|monitoring|logging|telemetry)(?:\/|[^/]*$)/i,
      /sentry|opentelemetry|datadog|pino|winston|otel/i,
      'logging, tracing, and error monitoring conventions',
    ),
    storage: packageSignal(
      /s3|minio|r2|uploadthing|cloudinary|sharp/i,
      /(?:^|\/)(?:storage|uploads?|media|assets)(?:\/|[^/]*$)/i,
      /s3|minio|r2|uploadthing|cloudinary/i,
      'file and object storage conventions',
    ),
    'graphql-rpc': packageSignal(
      /graphql|trpc|grpc|@connectrpc\//i,
      /(?:^|\/)(?:graphql|trpc|rpc)(?:\/|[^/]*$)/i,
      /graphql|trpc|grpc|@connectrpc\//i,
      'GraphQL and RPC conventions',
    ),
    i18n: packageSignal(
      /next-intl|i18next|react-i18next|lingui/i,
      /(?:^|\/)(?:i18n|locales?|messages|translations?)(?:\/|[^/]*$)/i,
      /next-intl|i18next|react-i18next|lingui/i,
      'internationalization conventions',
    ),
    dependencies: {
      status: 'observed',
      confidence: 'high',
      packages: allPackages,
      files: files
        .filter((file) => /(?:package\.json|lock$|lock\.yaml$)/i.test(file.path))
        .map((file) => file.path),
      imports: [],
      evidence: ['package manifest and lockfile metadata'],
    },
    configs: packageSignal(
      /^(?:cosmiconfig|convict|config|dotenv|jiti|tsx|ts-node)$/i,
      /(?:^|\/)(?:config|configs|configuration)(?:\/|[^/]*$)|(?:^|\/)[^/]+\.config\.[cm]?[jt]sx?$/i,
      /^(?:cosmiconfig|convict|config|dotenv|jiti|tsx|ts-node)(\/|$)/i,
      'configuration files and loaders',
    ),
    security: packageSignal(
      /(?:helmet|csrf|rate-limit|ratelimit|clerk|lucia|next-auth|better-auth|sentry|semgrep|zod|valibot|jose|bcrypt|argon2)/i,
      /(?:^|\/)(?:security|middleware|auth|authentication|permissions?|policies?|crypto)(?:\/|[^/]*$)/i,
      /(?:helmet|csrf|rate-limit|ratelimit|jose|bcrypt|argon2|sentry)(\/|$)/i,
      'security, validation, and permission conventions',
    ),
    webhooks: packageSignal(
      /stripe|svix|webhooks?[-/]?js|inngest|resend|paypal|paddle/i,
      /(?:^|\/)(?:webhooks?|events?)(?:\/|[^/]*$)/i,
      /(?:webhooks?|events?)(\/|$)/i,
      'webhook and event receiver conventions',
    ),
    cache: packageSignal(
      /redis|ioredis|upstash|lru-cache|node-cache|react-cache/i,
      /(?:^|\/)(?:cache|caching|redis)(?:\/|[^/]*$)/i,
      /redis|ioredis|upstash|lru-cache|node-cache/i,
      'cache and key-value storage conventions',
    ),
    analytics: packageSignal(
      /posthog|segment|mixpanel|amplitude|plausible|google-analytics|vercel\/analytics/i,
      /(?:^|\/)(?:analytics|tracking|telemetry)(?:\/|[^/]*$)/i,
      /posthog|segment|mixpanel|amplitude|plausible|analytics/i,
      'product analytics and tracking conventions',
    ),
    search: packageSignal(
      /algoliasearch|elasticsearch|opensearch|meilisearch|typesense|instantsearch/i,
      /(?:^|\/)(?:search|indexing|indexes)(?:\/|[^/]*$)/i,
      /algoliasearch|elasticsearch|opensearch|meilisearch|typesense|instantsearch/i,
      'search and indexing conventions',
    ),
    content: packageSignal(
      /contentlayer|mdx|remark|rehype|sanity|contentful|strapi|payload/i,
      /(?:^|\/)(?:content|cms|mdx|posts?|articles?)(?:\/|[^/]*$)/i,
      /contentlayer|remark|rehype|sanity|contentful|strapi|payload/i,
      'content and CMS conventions',
    ),
    tooling: packageSignal(
      /^(?:typescript|eslint|prettier|biome|dependency-cruiser|madge|knip|semgrep|snyk|npm-check-updates|lefthook|husky)$/i,
      /(?:^|\/)(?:\.github\/workflows|\.husky|\.lefthook|scripts?|tools?)(?:\/|[^/]*$)/i,
      /^(?:typescript|eslint|prettier|biome|dependency-cruiser|madge|knip|semgrep|snyk|lefthook|husky)(\/|$)/i,
      'static analysis, formatting, dependency graph, and hook tooling',
    ),
  };
  const scriptNames = Object.keys(scripts).filter((name) =>
    /deploy|worker|job|queue|seed|migrat/i.test(name),
  );
  if (scriptNames.length > 0) {
    capabilities.jobs = {
      ...capabilities.jobs,
      evidence: [...capabilities.jobs.evidence, `scripts: ${scriptNames.join(', ')}`],
    };
  }
  return Object.fromEntries(
    Object.entries(capabilities).filter(
      ([, signal]) =>
        signal.packages.length > 0 || signal.files.length > 0 || signal.imports.length > 0,
    ),
  );
}

function buildInsights(
  root: string,
  files: ProjectFileRecord[],
  modules: ModuleRecord[],
  dependencies: Record<string, string>,
  facts: LanguageProjectFacts,
): ProjectModel['insights'] {
  const layers: Record<string, string[]> = {};
  for (const file of files.filter((candidate) =>
    ['source', 'test', 'schema', 'migration'].includes(candidate.kind),
  )) {
    const layer = layerForPath(file.path);
    (layers[layer] ??= []).push(file.path);
  }
  for (const paths of Object.values(layers)) paths.sort();
  const importCounts = new Map<string, number>();
  for (const module of modules) {
    for (const importPath of module.imports) {
      if (languageRegistry.forPath(module.path)?.isImportHotspot(module, importPath)) {
        importCounts.set(importPath, (importCounts.get(importPath) ?? 0) + 1);
      }
    }
  }
  const importHotspots = [...importCounts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.module.localeCompare(b.module)))
    .slice(0, 30);
  const boundaries: ProjectModel['insights']['boundaries'] = [];
  const clientFiles = facts.clientComponents;
  if (clientFiles.length > 0) {
    boundaries.push({ kind: 'client', files: clientFiles, evidence: 'use client directive' });
  }
  const serverFiles = facts.serverActions;
  if (serverFiles.length > 0) {
    boundaries.push({ kind: 'server', files: serverFiles, evidence: 'use server directive' });
  }
  const ormPackages = Object.keys(dependencies).filter((name) =>
    ['drizzle-orm', 'prisma', 'typeorm', 'sequelize', 'mongoose', 'knex'].includes(name),
  );
  if (ormPackages.length > 0) {
    boundaries.push({
      kind: 'persistence',
      files: files
        .filter((file) => file.kind === 'schema' || layerForPath(file.path) === 'infrastructure')
        .map((file) => file.path),
      evidence: `ORM dependency: ${ormPackages.join(', ')}`,
    });
  }
  const moduleGraph = buildModuleTargetGraph(modules);
  const dependencyEdges = modules.flatMap(
    (module) =>
      moduleGraph.get(module.path)?.map((target) => ({ from: module.path, to: target })) ?? [],
  );
  const edgeCounts = new Map<string, number>();
  for (const module of modules) {
    const targets = moduleGraph.get(module.path) ?? [];
    for (const target of targets) {
      const edge = `${layerForPath(module.path)}\0${layerForPath(target)}`;
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }
  const layerEdges = [...edgeCounts.entries()]
    .map(([edge, count]) => {
      const [from, to] = edge.split('\0');
      return { from: from ?? 'unknown', to: to ?? 'unknown', count };
    })
    .sort((a, b) =>
      b.count !== a.count
        ? b.count - a.count
        : `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
    );
  return {
    layers,
    cycles: findCycles(modules),
    importHotspots,
    boundaries,
    layerEdges,
    dependencyEdges,
    impactPaths: buildImpactPaths(modules, facts.routeHandlers, facts.serverActions),
    envReferences: facts.environmentReads
      .map((reference) => ({
        ...reference,
        files: [...new Set(reference.files)].sort(),
        declared: (() => {
          try {
            const example = readFileSync(resolve(root, '.env.example'), 'utf8');
            return new RegExp(`^${reference.name}=`, 'm').test(example);
          } catch {
            return false;
          }
        })(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    importResolution: summarizeImportResolution(modules),
  };
}

function discoverProjectOnce(
  root: string,
  options: DiscoveryOptions = {},
  attempt = 0,
): ProjectModel {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new DiscoveryLimitError('Discovery maxFiles must be a positive integer.');
  }
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new DiscoveryLimitError('Discovery maxFileBytes must be a positive integer.');
  }
  const allFiles = listFiles(root, root, maxFiles);
  if (allFiles.length > maxFiles) {
    throw new DiscoveryLimitError(
      `Project contains ${allFiles.length} files; discovery limit is ${maxFiles}. ` +
        'Use an ignore file or raise maxFiles deliberately.',
    );
  }
  for (const path of allFiles) {
    const bytes = statSync(resolve(root, path)).size;
    if (bytes > maxFileBytes) {
      throw new DiscoveryLimitError(
        `File ${path} is ${bytes} bytes; discovery limit is ${maxFileBytes}. ` +
          'Ignore the file or raise maxFileBytes deliberately.',
      );
    }
  }
  const signature = discoverySignature(root, allFiles);
  const cacheKey = resolve(root);
  discoveryCacheHits.set(cacheKey, false);
  const cached = discoveryCache.get(cacheKey);
  if (cached?.signature === signature) {
    discoveryCacheHits.set(cacheKey, true);
    discoveryReuse.set(cacheKey, cached.model.modules.length);
    return cached.model;
  }
  let previousModel = cached?.model;
  let previousFingerprint = cached?.resolutionFingerprint;
  try {
    const persisted = JSON.parse(readFileSync(discoveryCachePath(root), 'utf8')) as {
      version?: unknown;
      signature?: unknown;
      resolutionFingerprint?: unknown;
      model?: unknown;
    };
    if (
      persisted.version === DISCOVERY_CACHE_VERSION &&
      typeof persisted.resolutionFingerprint === 'string' &&
      persisted.model !== null &&
      typeof persisted.model === 'object' &&
      (persisted.model as { version?: unknown }).version === 1
    ) {
      previousModel = persisted.model as ProjectModel;
      previousFingerprint = persisted.resolutionFingerprint;
      if (persisted.signature === signature) {
        discoveryCacheHits.set(cacheKey, true);
        discoveryCache.set(cacheKey, {
          signature,
          resolutionFingerprint: previousFingerprint,
          model: previousModel,
        });
        discoveryReuse.set(cacheKey, previousModel.modules.length);
        return previousModel;
      }
    }
  } catch {
    // A missing or invalid cache is a normal cold-start path.
  }
  const files = allFiles.map((path) => ({
    path,
    kind: fileKind(path),
    bytes: statSync(resolve(root, path)).size,
  }));
  const projectFiles = new Set(files.map((file) => file.path));
  const metadata = ecosystemRegistry.readProject({ root, allFiles });
  const { dependencies, devDependencies, scripts, packages: workspaces } = metadata;
  const workspaceNames = new Set(
    workspaces.flatMap((workspace) => (workspace.name ? [workspace.name] : [])),
  );
  const context = {
    root,
    allFiles,
    projectFiles,
    workspaceNames,
    resolutionRoots: ecosystemRegistry.resolutionRoots(allFiles),
  };
  const sessions = new Map(
    languageRegistry.backends
      .filter((backend) =>
        files.some(
          (file) =>
            languageRegistry.forPath(file.path) === backend &&
            (file.kind === 'source' || file.kind === 'test'),
        ),
      )
      .map((backend) => [backend, backend.createSession(context)]),
  );
  const previousModules = new Map(previousModel?.modules.map((module) => [module.path, module]));
  const currentFingerprint = resolutionFingerprint(root, allFiles);
  const canReuseModules = previousFingerprint === currentFingerprint;
  let reusedModules = 0;
  let modules = files
    .filter((file) => file.kind === 'source' || file.kind === 'test')
    .map((file) => {
      const previous = canReuseModules ? previousModules.get(file.path) : undefined;
      if (previous?.contentHash === contentHash(root, file.path)) {
        reusedModules += 1;
        return previous;
      }
      const backend = languageRegistry.forPath(file.path);
      return backend ? sessions.get(backend)?.parseModule(file.path) : undefined;
    })
    .filter((module): module is ModuleRecord => module !== undefined);
  const resolved = new Map<string, ModuleRecord>();
  for (const [backend, session] of sessions)
    for (const module of session.resolveModules(
      modules.filter((candidate) => languageRegistry.forPath(candidate.path) === backend),
    ))
      resolved.set(module.path, module);
  modules = modules.map((module) => resolved.get(module.path) ?? module);
  const sourceFiles = files.filter((file) => file.kind === 'source').map((file) => file.path);
  const testFiles = files.filter((file) => file.kind === 'test').map((file) => file.path);
  const configs = files.filter((file) => file.kind === 'config').map((file) => file.path);
  const schemas = files.filter((file) => file.kind === 'schema').map((file) => file.path);
  const testScripts = Object.fromEntries(
    Object.entries(scripts).filter(([name]) => /test|check|lint|type/.test(name)),
  );
  const facts: LanguageProjectFacts = {
    routeHandlers: [],
    routeDetails: [],
    barrelFiles: [],
    serverActions: [],
    clientComponents: [],
    environmentReads: [],
  };
  for (const [backend, session] of sessions) {
    const next = session.projectFacts(
      modules.filter((module) => languageRegistry.forPath(module.path) === backend),
      sourceFiles.filter((path) => languageRegistry.forPath(path) === backend),
    );
    facts.routeHandlers.push(...next.routeHandlers);
    facts.routeDetails.push(...next.routeDetails);
    facts.barrelFiles.push(...next.barrelFiles);
    facts.serverActions.push(...next.serverActions);
    facts.clientComponents.push(...next.clientComponents);
    for (const read of next.environmentReads) {
      const existing = facts.environmentReads.find((item) => item.name === read.name);
      if (existing) existing.files.push(...read.files);
      else facts.environmentReads.push({ ...read, files: [...read.files] });
    }
  }
  facts.routeHandlers.sort();
  facts.routeDetails.sort((a, b) => (a.path === b.path ? 0 : a.path < b.path ? -1 : 1));
  facts.barrelFiles.sort();
  facts.serverActions.sort();
  facts.clientComponents.sort();
  const model: ProjectModel = {
    version: 1,
    project: {
      ...(metadata.name !== undefined ? { name: metadata.name } : {}),
      ...(metadata.packageManager ? { packageManager: metadata.packageManager } : {}),
      frameworks: inferFrameworks(dependencies, devDependencies),
      scripts,
      dependencies,
      devDependencies,
      workspacePackages: workspaces,
    },
    files,
    modules,
    configs,
    schemas,
    tests: { files: testFiles, scripts: testScripts },
    capabilities: detectCapabilities(files, modules, dependencies, devDependencies, scripts),
    git: gitModel(root),
    patterns: {
      clientComponents: facts.clientComponents,
      serverActions: facts.serverActions,
      routeHandlers: facts.routeHandlers,
      routeDetails: facts.routeDetails,
      barrelFiles: facts.barrelFiles,
      importGraphEdges: modules.reduce((count, module) => count + module.imports.length, 0),
    },
    insights: buildInsights(root, files, modules, dependencies, facts),
  };
  const finalFiles = listFiles(root, root, maxFiles);
  const finalSignature =
    finalFiles.length <= maxFiles ? discoverySignature(root, finalFiles) : undefined;
  if (finalSignature !== signature) {
    if (attempt < 2) return discoverProjectOnce(root, options, attempt + 1);
    throw new DiscoveryStaleError();
  }
  discoveryCache.set(cacheKey, { signature, resolutionFingerprint: currentFingerprint, model });
  discoveryReuse.set(cacheKey, reusedModules);
  if (
    canPersistDiscoveryCache(root) &&
    (options.persistCache ?? existsSync(resolve(root, `.${config.appName}/guard`)))
  ) {
    try {
      mkdirSync(resolve(root, `.${config.appName}/guard`), { recursive: true });
      const cachePath = discoveryCachePath(root);
      const temporaryPath = `${cachePath}.tmp-${process.pid}`;
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(
          {
            version: DISCOVERY_CACHE_VERSION,
            signature,
            resolutionFingerprint: currentFingerprint,
            model,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      renameSync(temporaryPath, cachePath);
    } catch {
      // Discovery remains usable when the optional cache cannot be written.
    }
  }
  return model;
}

export function discoverProject(root: string, options: DiscoveryOptions = {}): ProjectModel {
  return discoverProjectOnce(root, options);
}

export function discoverProjectWithMetrics(
  root: string,
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const startedAt = Date.now();
  const model = discoverProject(root, options);
  return {
    model,
    metrics: {
      durationMs: Math.max(0, Date.now() - startedAt),
      files: model.files.length,
      modules: model.modules.length,
      cacheAvailable: existsSync(discoveryCachePath(root)),
      cacheHit: discoveryCacheHits.get(resolve(root)) ?? false,
      changedFiles: model.git.changedFiles.length,
      reusedModules: discoveryReuse.get(resolve(root)) ?? 0,
    },
  };
}
