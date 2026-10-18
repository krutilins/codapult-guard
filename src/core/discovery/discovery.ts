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
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import { config } from '../config.js';
import { parsePythonSource, type PythonImportFact } from './python-imports.js';
import {
  pythonResolutionIndex,
  resolvePythonImports,
  type PythonResolutionIndex,
} from './python-resolution.js';

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
  /** Python import statements as parsed, the input of Python resolution. */
  pythonImports?: PythonImportFact[] | undefined;
  /** Up to 5 lines with syntax error nodes. Informational; never produces findings (D3). */
  parseDiagnostics?: number[] | undefined;
  /** Absolute dotted name of each convertible Python relative import spelling (D7, D9). */
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
  };
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
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  '.codapult',
  '.vercel',
  'out',
  'playwright-report',
  'test-results',
  'certificates',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.eggs',
]);

function ignoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name.endsWith('.egg-info');
}

const JS_TS_SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);
const PYTHON_SOURCE_EXTENSIONS = new Set(['.py']);
/** Files whose presence marks a Python project root. Their content is not parsed (C2). */
const PYTHON_PROJECT_MARKERS = new Set(['pyproject.toml', 'setup.cfg', 'setup.py']);
const PYTHON_CONFIG_NAMES = new Set([
  'pipfile',
  'pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'pdm.lock',
  'setup.cfg',
  'pyproject.toml',
  'tox.ini',
]);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);
const CONFIG_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  '.eslintrc',
  '.prettierrc',
  'vite.config.ts',
  'vite.config.js',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'webpack.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
]);

const discoveryCache = new Map<
  string,
  { signature: string; resolutionFingerprint: string; model: ProjectModel }
>();
const discoveryReuse = new Map<string, number>();
const discoveryCacheHits = new Map<string, boolean>();
// Bump when the persisted model shape changes; old cache entries must never
// bypass discovery and return an incomplete ProjectModel.
const DISCOVERY_CACHE_VERSION = 7;

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

function contentHash(root: string, path: string): string {
  return createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex');
}

const RESOLUTION_CONFIG_NAME =
  /^(?:(?:tsconfig|jsconfig)(?:\..+)?\.json|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/;

/**
 * Fingerprint of everything JS/TS import resolution reads: the content of compiler configs,
 * package manifests, and lockfiles, plus the paths of files a specifier can resolve to. Module
 * records are reused only while it is unchanged. A dependency install that leaves the lockfile
 * unchanged is not detected.
 */
function resolutionFingerprint(root: string, allFiles: string[]): string {
  const hash = createHash('sha256');
  for (const path of [...allFiles].sort()) {
    const resolutionConfig = RESOLUTION_CONFIG_NAME.test(basename(path));
    const extension = extname(path);
    if (!resolutionConfig && !JS_TS_SOURCE_EXTENSIONS.has(extension) && extension !== '.json')
      continue;
    hash.update(`${path}\0${resolutionConfig ? contentHash(root, path) : ''}\n`);
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
      existsSync(resolve(directory, 'package.json')) ||
      existsSync(resolve(directory, 'tsconfig.json')) ||
      existsSync(resolve(directory, 'jsconfig.json')) ||
      [...PYTHON_PROJECT_MARKERS].some((marker) => existsSync(resolve(directory, marker)))
    ) {
      return directory;
    }
    directory = dirname(directory);
  }
  return resolve(from);
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function packageManager(root: string): string | undefined {
  const packageJson = readJsonObject(resolve(root, 'package.json'));
  if (typeof packageJson.packageManager === 'string') return packageJson.packageManager;
  for (const [file, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ] as const) {
    try {
      statSync(resolve(root, file));
      return manager;
    } catch {
      // Try the next lockfile.
    }
  }
  return undefined;
}

function workspacePackages(
  root: string,
  files: string[],
): ProjectModel['project']['workspacePackages'] {
  return files
    .filter((path) => path !== 'package.json' && basename(path) === 'package.json')
    .map((path) => {
      const manifest = readJsonObject(resolve(root, path));
      return {
        path: dirname(path).replaceAll('\\', '/') || '.',
        ...(typeof manifest.name === 'string' ? { name: manifest.name } : {}),
        private: manifest.private === true,
        scripts: asStringRecord(manifest.scripts),
        dependencies: Object.keys({
          ...asStringRecord(manifest.dependencies),
          ...asStringRecord(manifest.devDependencies),
          ...asStringRecord(manifest.peerDependencies),
        }).sort(),
        ...(manifest.exports !== undefined
          ? {
              exports: Array.isArray(manifest.exports)
                ? manifest.exports.filter((item): item is string => typeof item === 'string')
                : manifest.exports !== null && typeof manifest.exports === 'object'
                  ? Object.keys(manifest.exports)
                  : [],
            }
          : {}),
        ...(Array.isArray(readJsonObject(resolve(root, dirname(path), 'tsconfig.json')).references)
          ? {
              projectReferences: (
                readJsonObject(resolve(root, dirname(path), 'tsconfig.json'))
                  .references as unknown[]
              )
                .filter(
                  (reference): reference is { path: string } =>
                    reference !== null &&
                    typeof reference === 'object' &&
                    typeof (reference as { path?: unknown }).path === 'string',
                )
                .map((reference) => reference.path)
                .sort(),
            }
          : {}),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
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

type SourceLanguage = 'js-ts' | 'python';

/** Language of a source file by extension. Import resolution never crosses languages. */
function sourceLanguage(path: string): SourceLanguage | undefined {
  const extension = extname(path);
  if (JS_TS_SOURCE_EXTENSIONS.has(extension)) return 'js-ts';
  if (PYTHON_SOURCE_EXTENSIONS.has(extension)) return 'python';
  return undefined;
}

/** Python test files (D11): `test_*.py`, `*_test.py`, `conftest.py`, or a `tests`/`test` segment. */
function pythonTestFile(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  const name = segments.pop() ?? '';
  return (
    /^test_.*\.py$|_test\.py$|^conftest\.py$/.test(name) ||
    segments.some((segment) => segment === 'tests' || segment === 'test')
  );
}

function fileKind(path: string): ProjectFileRecord['kind'] {
  const name = basename(path).toLowerCase();
  if (sourceLanguage(path) === 'python') {
    // Python modules named like configs or schemas (settings/config.py, app/schemas.py) are
    // ordinary modules, so only the test and migration checks apply.
    if (pythonTestFile(path)) return 'test';
    if (path.includes('/migrations/')) return 'migration';
    return 'source';
  }
  if (/\.(?:test|spec)\.[^.]+$/.test(name) || path.includes('/__tests__/')) return 'test';
  if (name.includes('schema') || path.includes('/schemas/')) return 'schema';
  if (path.includes('/migrations/') || path.includes('/drizzle/')) return 'migration';
  // Before the documentation check, which would classify requirements.txt by its extension.
  if (PYTHON_CONFIG_NAMES.has(name) || /^requirements.*\.txt$/.test(name)) return 'config';
  if (DOCUMENTATION_EXTENSIONS.has(extname(name))) return 'documentation';
  if (CONFIG_NAMES.has(name) || name.includes('config')) return 'config';
  if (JS_TS_SOURCE_EXTENSIONS.has(extname(name))) return 'source';
  return 'other';
}

/**
 * Directories containing a Python project marker, sorted, with `.` for the project root. Task 05
 * uses them as resolution roots (D9).
 */
export function pythonProjectRoots(paths: string[]): string[] {
  return [
    ...new Set(
      paths
        .filter((path) => PYTHON_PROJECT_MARKERS.has(basename(path)))
        .map((path) => dirname(path).replaceAll('\\', '/')),
    ),
  ].sort();
}

/**
 * JS/TS resolution candidates for a project-relative path base. Another language's source file is
 * never one. A trailing slash limits the candidates to the directory index, and `.` or an empty
 * base names the project root.
 */
function jsTsResolutionCandidates(base: string): string[] {
  const directoryOnly = base.endsWith('/');
  const trimmed = base.replace(/\/+$/, '');
  const isRoot = trimmed === '' || trimmed === '.';
  const indexBase = isRoot ? 'index' : `${trimmed}/index`;
  const baseLanguage = sourceLanguage(trimmed);
  const fileCandidates =
    directoryOnly || isRoot
      ? []
      : [
          ...(baseLanguage === undefined || baseLanguage === 'js-ts' ? [trimmed] : []),
          ...[...JS_TS_SOURCE_EXTENSIONS].map((extension) => `${trimmed}${extension}`),
        ];
  return [
    ...fileCandidates,
    ...[...JS_TS_SOURCE_EXTENSIONS].map((extension) => `${indexBase}${extension}`),
  ];
}

function sourceFilePath(
  root: string,
  sourceFile: SourceFile,
  projectFiles: Set<string>,
): string | undefined {
  const path = relative(root, sourceFile.getFilePath()).replaceAll('\\', '/');
  return path.startsWith('..') || !projectFiles.has(path) ? undefined : path;
}

function resolveInternalImport(
  from: string,
  importPath: string,
  modules: Set<string>,
): string | undefined {
  if (!importPath.startsWith('.')) return undefined;
  const base = normalize(join(dirname(from), importPath));
  return jsTsResolutionCandidates(base).find((candidate) => modules.has(candidate));
}

interface PathAlias {
  pattern: string;
  baseDirectory: string;
  targets: string[];
}

function pathAliases(root: string): PathAlias[] {
  return listFiles(root)
    .filter((path) => basename(path) === 'tsconfig.json' || basename(path) === 'jsconfig.json')
    .flatMap((path) => {
      const tsconfigJson = readJsonObject(resolve(root, path));
      const compilerOptions =
        tsconfigJson.compilerOptions !== null && typeof tsconfigJson.compilerOptions === 'object'
          ? (tsconfigJson.compilerOptions as Record<string, unknown>)
          : {};
      const paths = compilerOptions.paths;
      if (paths === null || typeof paths !== 'object') return [];
      const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
      return Object.entries(paths).flatMap(([pattern, value]) => {
        if (!Array.isArray(value)) return [];
        const targets = value.filter((item): item is string => typeof item === 'string');
        return targets.length > 0
          ? [{ pattern, baseDirectory: resolve(root, dirname(path), baseUrl), targets }]
          : [];
      });
    });
}

function aliasParts(alias: PathAlias): { prefix: string; suffix: string } {
  const wildcard = alias.pattern.indexOf('*');
  return wildcard >= 0
    ? { prefix: alias.pattern.slice(0, wildcard), suffix: alias.pattern.slice(wildcard + 1) }
    : { prefix: alias.pattern, suffix: '' };
}

/** The text an alias wildcard matches, or undefined when the specifier does not match the alias. */
function aliasReplacement(alias: PathAlias, importPath: string): string | undefined {
  const { prefix, suffix } = aliasParts(alias);
  if (!importPath.startsWith(prefix) || (suffix && !importPath.endsWith(suffix))) return undefined;
  return importPath.slice(prefix.length, importPath.length - suffix.length);
}

function resolveAliasedImport(
  root: string,
  importPath: string,
  aliases: PathAlias[],
  modules: Set<string>,
): string | undefined {
  for (const alias of aliases) {
    const replacement = aliasReplacement(alias, importPath);
    if (replacement === undefined) continue;
    for (const target of alias.targets) {
      const targetPath = target.replace('*', replacement);
      const absoluteBase = resolve(alias.baseDirectory, targetPath);
      const relativeBase = relative(root, absoluteBase);
      const normalizedBase = relativeBase.replace(/^\.\//, '').replaceAll('\\', '/');
      const projectCandidate = jsTsResolutionCandidates(normalizedBase).find((candidate) =>
        modules.has(candidate),
      );
      if (projectCandidate) return projectCandidate;
    }
  }
  return undefined;
}

/**
 * Specifiers that point at project code by JS/TS rules but resolve to no project file: relative
 * and absolute paths, path aliases, and workspace package names. Relative specifiers that the
 * path fallback resolves, including non-module files such as stylesheets, are not unresolved.
 */
function unresolvedJsTsImports(
  path: string,
  specifiers: string[],
  resolvedImportMap: Record<string, string>,
  projectFiles: Set<string>,
  aliases: PathAlias[],
  workspaceNames: ReadonlySet<string>,
): string[] {
  return specifiers
    .filter((specifier) => {
      if (Object.hasOwn(resolvedImportMap, specifier)) return false;
      if (specifier.startsWith('.')) {
        return resolveInternalImport(path, specifier, projectFiles) === undefined;
      }
      if (specifier.startsWith('/')) return true;
      // A catch-all alias such as "*" would classify every package as local.
      const matchesAlias = aliases.some(
        (alias) =>
          aliasParts(alias).prefix !== '' && aliasReplacement(alias, specifier) !== undefined,
      );
      return (
        matchesAlias ||
        [...workspaceNames].some((name) => specifier === name || specifier.startsWith(`${name}/`))
      );
    })
    .sort();
}

function parseJsTsModule(
  project: Project,
  root: string,
  path: string,
  projectFiles: Set<string>,
  aliases: PathAlias[],
): ModuleRecord | undefined {
  let sourceFile: SourceFile;
  try {
    sourceFile =
      project.getSourceFile(resolve(root, path)) ??
      project.addSourceFileAtPath(resolve(root, path));
  } catch {
    return undefined;
  }
  const imports: string[] = [];
  const importedSymbols: string[] = [];
  const exports: string[] = [];
  const dynamicImports: string[] = [];
  const declarations = { classes: 0, functions: 0, interfaces: 0, types: 0, variables: 0 };
  const resolvedImports = new Set<string>();
  const resolvedImportMap: Record<string, string> = {};
  // Static imports take precedence over re-exports, which take precedence over dynamic imports.
  const importLines: Record<string, number> = {};
  const recordLine = (specifier: string, line: number): void => {
    if (!Object.hasOwn(importLines, specifier)) importLines[specifier] = line;
  };
  for (const declaration of sourceFile.getImportDeclarations()) {
    const importPath = declaration.getModuleSpecifierValue();
    imports.push(importPath);
    recordLine(importPath, declaration.getStartLineNumber());
    const defaultImport = declaration.getDefaultImport()?.getText();
    if (defaultImport) importedSymbols.push(defaultImport);
    const namespaceImport = declaration.getNamespaceImport()?.getText();
    if (namespaceImport) importedSymbols.push(namespaceImport);
    for (const namedImport of declaration.getNamedImports()) {
      importedSymbols.push(namedImport.getAliasNode()?.getText() ?? namedImport.getName());
    }
    const resolved = declaration.getModuleSpecifierSourceFile();
    const resolvedPath =
      (resolved && sourceFilePath(root, resolved, projectFiles)) ??
      resolveAliasedImport(root, importPath, aliases, projectFiles);
    if (resolvedPath) {
      resolvedImports.add(resolvedPath);
      resolvedImportMap[importPath] = resolvedPath;
    }
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;
    exports.push(moduleSpecifier);
    recordLine(moduleSpecifier, declaration.getStartLineNumber());
    const resolved = declaration.getModuleSpecifierSourceFile();
    const resolvedPath =
      (resolved && sourceFilePath(root, resolved, projectFiles)) ??
      resolveAliasedImport(root, moduleSpecifier, aliases, projectFiles);
    if (resolvedPath) {
      resolvedImports.add(resolvedPath);
      resolvedImportMap[moduleSpecifier] = resolvedPath;
    }
  }
  declarations.classes = sourceFile.getClasses().length;
  declarations.functions = sourceFile.getFunctions().length;
  declarations.interfaces = sourceFile.getInterfaces().length;
  declarations.types = sourceFile.getTypeAliases().length;
  declarations.variables = sourceFile.getVariableStatements().length;
  const calls = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((call) => call.getExpression().getText())
    .filter((expression) => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression));
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression().getText();
    if (expression !== 'import' && expression !== 'require') continue;
    const argument = call.getArguments()[0];
    if (!argument.isKind(SyntaxKind.StringLiteral)) continue;
    const importPath = argument.getText().slice(1, -1);
    if (!importPath) continue;
    dynamicImports.push(importPath);
    recordLine(importPath, call.getStartLineNumber());
    const resolvedPath =
      resolveInternalImport(path, importPath, projectFiles) ??
      resolveAliasedImport(root, importPath, aliases, projectFiles);
    if (resolvedPath) {
      resolvedImports.add(resolvedPath);
      resolvedImportMap[importPath] = resolvedPath;
    }
  }
  const directives = sourceFile
    .getStatements()
    .filter((statement) => statement.isKind(SyntaxKind.ExpressionStatement))
    .map((statement) => statement.getExpression())
    .filter((expression) => {
      if (!expression.isKind(SyntaxKind.StringLiteral)) return false;
      const value = expression.getText().slice(1, -1);
      return value === 'use client' || value === 'use server';
    })
    .map((expression) => expression.getText().slice(1, -1));
  return {
    path,
    contentHash: contentHash(root, path),
    imports: [...new Set(imports)].sort(),
    importedSymbols: [...new Set(importedSymbols)].sort(),
    exports: [...new Set(exports)].sort(),
    calls: [...new Set(calls)].sort(),
    resolvedImports: [...resolvedImports].sort(),
    resolvedImportMap,
    importLines,
    dynamicImports: [...new Set(dynamicImports)].sort(),
    declarations,
    directives,
  };
}

/** Python parse facts (D4). Resolution fields are filled by the Python resolver (Task 05). */
function parsePythonModule(root: string, path: string): ModuleRecord | undefined {
  let source: string;
  try {
    source = readFileSync(resolve(root, path), 'utf8');
  } catch {
    return undefined;
  }
  const parsed = parsePythonSource(source);
  const importLines: Record<string, number> = {};
  for (const fact of parsed.imports) {
    if (!Object.hasOwn(importLines, fact.module)) importLines[fact.module] = fact.line;
  }
  return {
    path,
    contentHash: contentHash(root, path),
    imports: [...new Set(parsed.imports.map((fact) => fact.module))].sort(),
    importedSymbols: [...new Set(parsed.importedSymbols)].sort(),
    exports: [],
    calls: [],
    resolvedImports: [],
    resolvedImportMap: {},
    importLines,
    dynamicImports: [],
    declarations: parsed.declarations,
    directives: [],
    pythonImports: parsed.imports,
    ...(parsed.errorLines.length > 0 ? { parseDiagnostics: parsed.errorLines } : {}),
  };
}

function parseModule(
  project: Project,
  root: string,
  path: string,
  projectFiles: Set<string>,
  aliases: PathAlias[],
): ModuleRecord | undefined {
  const language = sourceLanguage(path);
  if (language === 'js-ts') return parseJsTsModule(project, root, path, projectFiles, aliases);
  if (language === 'python') return parsePythonModule(root, path);
  return undefined;
}

/** Replaces a Python module's resolution fields with a fresh resolution of its parse facts (D18). */
function withPythonResolution(module: ModuleRecord, index: PythonResolutionIndex): ModuleRecord {
  if (module.pythonImports === undefined) return module;
  const { canonicalImports, ...resolution } = resolvePythonImports(
    module.path,
    module.pythonImports,
    index,
  );
  return {
    ...module,
    ...resolution,
    canonicalImports: Object.keys(canonicalImports).length > 0 ? canonicalImports : undefined,
  };
}

/**
 * Adds `unresolvedImports` to a parsed or reused module. It runs on every discovery because the
 * result depends on non-source files, such as `./styles.css`, that do not invalidate module reuse.
 */
function withImportStatus(
  module: ModuleRecord,
  projectFiles: Set<string>,
  aliases: PathAlias[],
  workspaceNames: ReadonlySet<string>,
): ModuleRecord {
  if (sourceLanguage(module.path) !== 'js-ts') return module;
  return {
    ...module,
    unresolvedImports: unresolvedJsTsImports(
      module.path,
      [...new Set([...module.imports, ...module.exports, ...module.dynamicImports])],
      module.resolvedImportMap ?? {},
      projectFiles,
      aliases,
      workspaceNames,
    ),
  };
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
  if (sourceLanguage(module.path) === 'python') {
    // `from app import services` needs only the derived `app.services`, not `app` itself.
    const prefix = specifier.endsWith('.') ? specifier : `${specifier}.`;
    const satisfiedByChildren = Object.keys(module.resolvedImportMap ?? {}).some(
      (key) => key.startsWith(prefix) && /^[^.]+$/.test(key.slice(prefix.length)),
    );
    if (satisfiedByChildren) return 'resolved';
    return specifier.startsWith('.') ? 'unresolved' : 'external';
  }
  return specifier.startsWith('.') ? 'resolved' : 'external';
}

function runGit(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  } catch (error) {
    const stdout = (error as { stdout?: Buffer | undefined }).stdout;
    return stdout?.toString().trim() || undefined;
  }
}

function discoverySignature(
  root: string,
  packageJson: Record<string, unknown>,
  allFiles: string[],
): string {
  return JSON.stringify([
    JSON.stringify(packageJson),
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
  if (sourceLanguage(path) === 'python' && pythonTestFile(path)) return 'tests';
  if (segments.some((segment) => ['app', 'pages', 'routes', 'api'].includes(segment))) {
    return 'routes';
  }
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
      if (sourceLanguage(module.path) === 'js-ts') {
        for (const importPath of [...module.imports, ...module.dynamicImports]) {
          const target = resolveInternalImport(module.path, importPath, moduleSet);
          if (target) targets.add(target);
        }
      }
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
  sourceFiles: string[],
  dependencies: Record<string, string>,
  astProject: Project,
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
    const python = module.pythonImports !== undefined;
    for (const importPath of module.imports) {
      // Python local imports have no `.` or `@/` marker, so their resolution status decides.
      if (python && importResolutionStatus(module, importPath) !== 'external') continue;
      if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
        importCounts.set(importPath, (importCounts.get(importPath) ?? 0) + 1);
      }
    }
  }
  const importHotspots = [...importCounts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.module.localeCompare(b.module)))
    .slice(0, 30);
  const boundaries: ProjectModel['insights']['boundaries'] = [];
  const clientFiles = modules
    .filter((module) => module.directives.includes('use client'))
    .map((module) => module.path);
  if (clientFiles.length > 0) {
    boundaries.push({ kind: 'client', files: clientFiles, evidence: 'use client directive' });
  }
  const serverFiles = modules
    .filter((module) => module.directives.includes('use server'))
    .map((module) => module.path);
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
    impactPaths: buildImpactPaths(
      modules,
      sourceFiles.filter((path) => /(?:^|\/)route\.[cm]?[jt]sx?$/.test(path)),
      modules
        .filter((module) => module.directives.includes('use server'))
        .map((module) => module.path),
    ),
    envReferences: sourceFiles
      .reduce<{ name: string; files: string[] }[]>((references, path) => {
        const sourceFile = astProject.getSourceFile(resolve(root, path));
        if (!sourceFile) return references;
        const names = new Set<string>();
        for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
          const expression = access.getExpression().getText();
          const name = access.getName();
          if (
            (expression === 'process.env' || expression === 'env') &&
            /^[A-Z][A-Z0-9_]*$/.test(name)
          ) {
            names.add(name);
          }
        }
        for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
          if (access.getExpression().getText() !== 'process.env') continue;
          const argument = access.getArgumentExpression();
          if (!argument?.isKind(SyntaxKind.StringLiteral)) continue;
          const name = argument.getLiteralValue();
          if (typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name)) names.add(name);
        }
        for (const name of names) {
          const reference = references.find((item) => item.name === name);
          if (reference) reference.files.push(path);
          else references.push({ name, files: [path] });
        }
        return references;
      }, [])
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
  };
}

function createAstProject(root: string): Project {
  const tsConfigPath = resolve(root, 'tsconfig.json');
  try {
    const project = existsSync(tsConfigPath)
      ? new Project({ tsConfigFilePath: tsConfigPath })
      : new Project({ skipAddingFilesFromTsConfig: true });
    // Monorepos commonly keep compiler options and path aliases per package.
    // Load those projects as well; files still remain bounded by listFiles().
    for (const configPath of listFiles(root).filter((path) => basename(path) === 'tsconfig.json')) {
      const absolutePath = resolve(root, configPath);
      if (absolutePath === tsConfigPath) continue;
      try {
        project.addSourceFilesFromTsConfig(absolutePath);
      } catch {
        // A package config can be partial or reference an unavailable project.
      }
    }
    return project;
  } catch {
    return new Project({ skipAddingFilesFromTsConfig: true });
  }
}

function discoverProjectOnce(
  root: string,
  options: DiscoveryOptions = {},
  attempt = 0,
): ProjectModel {
  const packageJson = readJsonObject(resolve(root, 'package.json'));
  const dependencies = asStringRecord(packageJson.dependencies);
  const devDependencies = asStringRecord(packageJson.devDependencies);
  const scripts = asStringRecord(packageJson.scripts);
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
  const signature = discoverySignature(root, packageJson, allFiles);
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
  const astProject = createAstProject(root);
  const aliases = pathAliases(root);
  const workspaces = workspacePackages(root, allFiles);
  const workspaceNames = new Set(
    workspaces.flatMap((workspace) => (workspace.name ? [workspace.name] : [])),
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
      return parseModule(astProject, root, file.path, projectFiles, aliases);
    })
    .filter((module): module is ModuleRecord => module !== undefined)
    .map((module) => withImportStatus(module, projectFiles, aliases, workspaceNames));
  const pythonIndex = modules.some((module) => module.pythonImports !== undefined)
    ? pythonResolutionIndex(allFiles, pythonProjectRoots(allFiles))
    : undefined;
  if (pythonIndex) {
    modules = modules.map((module) => withPythonResolution(module, pythonIndex));
  }
  const sourceFiles = files.filter((file) => file.kind === 'source').map((file) => file.path);
  const testFiles = files.filter((file) => file.kind === 'test').map((file) => file.path);
  const configs = files.filter((file) => file.kind === 'config').map((file) => file.path);
  const schemas = files.filter((file) => file.kind === 'schema').map((file) => file.path);
  const testScripts = Object.fromEntries(
    Object.entries(scripts).filter(([name]) => /test|check|lint|type/.test(name)),
  );
  const routeDetails = sourceFiles
    .filter((path) => /(?:^|\/)route\.[cm]?[jt]sx?$/.test(path))
    .map((path) => {
      const sourceFile = astProject.getSourceFile(resolve(root, path));
      const methods = new Set<string>();
      for (const declaration of sourceFile?.getFunctions() ?? []) {
        const name = declaration.getName();
        if (declaration.isExported() && name && HTTP_METHODS.has(name)) methods.add(name);
      }
      for (const statement of sourceFile?.getVariableStatements() ?? []) {
        if (!statement.isExported()) continue;
        for (const declaration of statement.getDeclarations()) {
          const name = declaration.getName();
          if (HTTP_METHODS.has(name)) methods.add(name);
        }
      }
      for (const name of sourceFile?.getExportedDeclarations().keys() ?? []) {
        if (HTTP_METHODS.has(name)) methods.add(name);
      }
      return { path, methods: [...methods].sort() };
    });
  const detectedPackageManager = packageManager(root);
  const model: ProjectModel = {
    version: 1,
    project: {
      ...(typeof packageJson.name === 'string' ? { name: packageJson.name } : {}),
      ...(detectedPackageManager ? { packageManager: detectedPackageManager } : {}),
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
      clientComponents: modules
        .filter((module) => module.directives.includes('use client'))
        .map((module) => module.path),
      serverActions: modules
        .filter((module) => module.directives.includes('use server'))
        .map((module) => module.path),
      routeHandlers: sourceFiles.filter((path) => /(?:^|\/)route\.[cm]?[jt]sx?$/.test(path)),
      routeDetails,
      barrelFiles: sourceFiles.filter((path) => /(?:^|\/)index\.[cm]?[jt]s$/.test(path)),
      importGraphEdges: modules.reduce((count, module) => count + module.imports.length, 0),
    },
    insights: buildInsights(root, files, modules, sourceFiles, dependencies, astProject),
  };
  const finalFiles = listFiles(root, root, maxFiles);
  const finalSignature =
    finalFiles.length <= maxFiles
      ? discoverySignature(root, readJsonObject(resolve(root, 'package.json')), finalFiles)
      : undefined;
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
