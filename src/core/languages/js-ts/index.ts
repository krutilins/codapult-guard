import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';
import type { ModuleRecord } from '../../discovery/discovery.js';
import { readJsonObject, contentHash } from '../../files.js';
import { languageRegistry } from '../index.js';
import { pathMatches } from '../shared.js';
import type { LanguageBackend, LanguageProjectFacts } from '../types.js';
const require = createRequire(import.meta.url);
let parser: typeof import('ts-morph') | undefined;
function loadParser(): typeof import('ts-morph') {
  return (parser ??= require('ts-morph') as typeof import('ts-morph'));
}
export function isJsTsParserLoaded(): boolean {
  return parser !== undefined;
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
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
function jsTsResolutionCandidates(base: string): string[] {
  const directoryOnly = base.endsWith('/');
  const trimmed = base.replace(/\/+$/, '');
  const isRoot = trimmed === '' || trimmed === '.';
  const indexBase = isRoot ? 'index' : `${trimmed}/index`;
  const owner = languageRegistry.forPath(trimmed);
  const ownedOrAsset = owner === undefined || owner.extensions === JS_TS_SOURCE_EXTENSIONS;
  const fileCandidates =
    directoryOnly || isRoot
      ? []
      : [
          ...(ownedOrAsset ? [trimmed] : []),
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

function pathAliases(root: string, allFiles: string[]): PathAlias[] {
  return allFiles
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
  const { SyntaxKind } = loadParser();
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

function withImportStatus(
  module: ModuleRecord,
  projectFiles: Set<string>,
  aliases: PathAlias[],
  workspaceNames: ReadonlySet<string>,
): ModuleRecord {
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

function createAstProject(root: string, allFiles: string[]): Project {
  const { Project } = loadParser();
  const tsConfigPath = resolve(root, 'tsconfig.json');
  try {
    const project = existsSync(tsConfigPath)
      ? new Project({ tsConfigFilePath: tsConfigPath })
      : new Project({ skipAddingFilesFromTsConfig: true });
    // Monorepos commonly keep compiler options and path aliases per package.
    // Load those projects as well; files still remain bounded by listFiles().
    for (const configPath of allFiles.filter((path) => basename(path) === 'tsconfig.json')) {
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

function projectFacts(
  astProject: Project,
  root: string,
  modules: ModuleRecord[],
  sourceFiles: string[],
): LanguageProjectFacts {
  const { SyntaxKind } = loadParser();
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
  return {
    routeHandlers: sourceFiles.filter((path) => /(?:^|\/)route\.[cm]?[jt]sx?$/.test(path)),
    routeDetails,
    barrelFiles: sourceFiles.filter((path) => /(?:^|\/)index\.[cm]?[jt]s$/.test(path)),
    serverActions: modules
      .filter((module) => module.directives.includes('use server'))
      .map((module) => module.path),
    clientComponents: modules
      .filter((module) => module.directives.includes('use client'))
      .map((module) => module.path),
    environmentReads: sourceFiles
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
      .map((reference) => ({ ...reference, files: [...new Set(reference.files)].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export const jsTsBackend = {
  id: 'js-ts' as const,
  ecosystem: 'npm',
  extensions: JS_TS_SOURCE_EXTENSIONS,
  collectedFacts: ['imports', 'calls', 'directives', 'packages', 'environment'],
  routeLayerSegments: ['app', 'pages', 'routes', 'api'],
  isTestFile(path) {
    return path.toLowerCase().split('/').includes('__tests__') || /\.(?:test|spec)\./.test(path);
  },
  classifyFile(path) {
    const name = basename(path).toLowerCase();
    if (/\.(?:test|spec)\.[^.]+$/.test(name) || path.includes('/__tests__/')) return 'test';
    if (name.includes('schema') || path.includes('/schemas/')) return 'schema';
    if (path.includes('/migrations/') || path.includes('/drizzle/')) return 'migration';
    return name.includes('config') ? 'config' : 'source';
  },
  createSession(context) {
    const project = createAstProject(context.root, context.allFiles);
    const aliases = pathAliases(context.root, context.allFiles);
    return {
      parseModule(path) {
        return parseJsTsModule(project, context.root, path, context.projectFiles, aliases);
      },
      resolveModules(modules) {
        return modules.map((module) =>
          withImportStatus(module, context.projectFiles, aliases, context.workspaceNames),
        );
      },
      projectFacts(modules, sourceFiles) {
        return projectFacts(project, context.root, modules, sourceFiles);
      },
    };
  },
  resolutionInput(path) {
    if (/^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(basename(path))) return 'content';
    return JS_TS_SOURCE_EXTENSIONS.has(extname(path)) || extname(path) === '.json'
      ? 'path'
      : undefined;
  },
  importStatus(_module, specifier) {
    return specifier.startsWith('.') ? 'resolved' : 'external';
  },
  referenceMatches(reference, pattern) {
    return pathMatches(reference.source, pattern);
  },
  fallbackTargets(module, files) {
    return [...module.imports, ...module.dynamicImports].flatMap((specifier) => {
      const target = resolveInternalImport(module.path, specifier, files);
      return target ? [target] : [];
    });
  },
  isImportHotspot(_module, specifier) {
    return !specifier.startsWith('.') && !specifier.startsWith('@/');
  },
} satisfies LanguageBackend;
