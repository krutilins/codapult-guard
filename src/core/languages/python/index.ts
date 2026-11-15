import { packageForModule } from '../index.js';
import { pythonProjectFacts } from './project-facts.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleRecord } from '../../discovery/discovery.js';
import { contentHash } from '../../files.js';
import { parsePythonSource, type PythonImportFact } from './python-imports.js';
import {
  pythonResolutionIndex,
  resolvePythonImports,
  type PythonResolutionIndex,
} from './python-resolution.js';
import { pathMatches } from '../shared.js';
import type { LanguageBackend } from '../types.js';
function pythonTestFile(path: string): boolean {
  const segments = path.toLowerCase().split('/');
  const name = segments.pop() ?? '';
  return (
    /^test_.*\.py$|_test\.py$|^conftest\.py$/.test(name) ||
    segments.some((segment) => segment === 'tests' || segment === 'test')
  );
}

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
    calls: parsed.syntax.calls,
    resolvedImports: [],
    resolvedImportMap: {},
    importLines,
    dynamicImports: [],
    declarations: parsed.declarations,
    directives: [],
    parseFacts: { imports: parsed.imports, syntax: parsed.syntax },
    ...(parsed.errorLines.length > 0 ? { incompleteFacts: ['calls' as const] } : {}),
    ...(parsed.errorLines.length > 0 ? { parseDiagnostics: parsed.errorLines } : {}),
  };
}

function withPythonResolution(module: ModuleRecord, index: PythonResolutionIndex): ModuleRecord {
  const facts = module.parseFacts as { imports?: PythonImportFact[] } | undefined;
  if (!facts?.imports) return module;
  const { canonicalImports, ...resolution } = resolvePythonImports(
    module.path,
    facts.imports,
    index,
  );
  return {
    ...module,
    ...resolution,
    canonicalImports: Object.keys(canonicalImports).length > 0 ? canonicalImports : undefined,
  };
}

function nameMatches(name: string, pattern: string): boolean {
  return pathMatches(name, pattern) || (!pattern.endsWith('*') && name.startsWith(`${pattern}.`));
}
export const pythonBackend = {
  id: 'python' as const,
  ecosystem: 'python',
  extensions: new Set(['.py']),
  collectedFacts: ['imports', 'calls', 'packages', 'environment'],
  factsForModule(path, model) {
    return packageForModule(model, path)
      ? ['imports', 'calls', 'packages', 'environment']
      : ['imports', 'calls', 'environment'];
  },
  routeLayerSegments: ['routes', 'api'],
  isTestFile: pythonTestFile,
  classifyFile(path) {
    return pythonTestFile(path) ? 'test' : path.includes('/migrations/') ? 'migration' : 'source';
  },
  createSession(context) {
    const index = pythonResolutionIndex(context.allFiles, context.resolutionRoots.python ?? []);
    return {
      parseModule(path) {
        return parsePythonModule(context.root, path);
      },
      resolveModules(modules) {
        return modules.map((module) => withPythonResolution(module, index));
      },
      projectFacts(modules, sourceFiles) {
        return pythonProjectFacts(
          modules.filter((module) => sourceFiles.includes(module.path)),
          context,
        );
      },
    };
  },
  // Python re-resolves every discovery; layout changes do not invalidate reusable parse facts.
  resolutionInput() {
    return undefined;
  },
  importStatus(module, specifier) {
    const prefix = specifier.endsWith('.') ? specifier : `${specifier}.`;
    if (
      Object.keys(module.resolvedImportMap ?? {}).some(
        (key) => key.startsWith(prefix) && /^[^.]+$/.test(key.slice(prefix.length)),
      )
    )
      return 'resolved';
    return specifier.startsWith('.') ? 'unresolved' : 'external';
  },
  referenceMatches(reference, pattern) {
    return (
      nameMatches(reference.source, pattern) ||
      (reference.canonical !== undefined && nameMatches(reference.canonical, pattern))
    );
  },
  fallbackTargets() {
    return [];
  },
  isImportHotspot(module, specifier): boolean {
    if (
      module.resolvedImportMap?.[specifier] !== undefined ||
      module.unresolvedImports?.includes(specifier)
    )
      return false;
    return (
      pythonBackend.importStatus(module, specifier) === 'external' &&
      !specifier.startsWith('.') &&
      !specifier.startsWith('@/')
    );
  },
} satisfies LanguageBackend;
