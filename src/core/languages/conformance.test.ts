import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLanguageRegistry, languageRegistry } from './index.js';
import type { LanguageBackend, LanguageContext } from './types.js';
import type { ModuleRecord } from '../discovery/discovery.js';
import { emptyProjectFacts } from './shared.js';
import { contentHash } from '../files.js';

const roots: string[] = [];
afterEach(() => {
  vi.doUnmock('./index.js');
  vi.resetModules();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-conformance-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
function context(root: string, paths: string[]): LanguageContext {
  return {
    root,
    allFiles: paths,
    projectFiles: new Set(paths),
    workspaceNames: new Set(),
    resolutionRoots: {},
  };
}

// Deliberately uses neither dotted nor slash-separated source names.
const fakeBackend: LanguageBackend = {
  id: 'fake',
  extensions: new Set(['.fake']),
  collectedFacts: ['imports'],
  routeLayerSegments: ['entry'],
  classifyFile: () => 'source',
  isTestFile: () => false,
  resolutionInput: () => undefined,
  importStatus: () => 'external',
  fallbackTargets: () => [],
  referenceMatches(reference, pattern) {
    return reference.source === pattern || reference.source.startsWith(`${pattern}::`);
  },
  isImportHotspot: () => false,
  createSession(ctx) {
    return {
      parseModule(path) {
        const source = readFileSync(join(ctx.root, path), 'utf8');
        const imports = [...source.matchAll(/^use "([^"]+)"/gm)];
        return {
          path,
          contentHash: contentHash(ctx.root, path),
          imports: imports.map((match) => match[1]),
          importLines: Object.fromEntries(
            imports.map((match) => [match[1], source.slice(0, match.index).split('\n').length]),
          ),
          importedSymbols: [],
          exports: [],
          calls: [],
          dynamicImports: [],
          directives: [],
          resolvedImports: [],
          declarations: { classes: 0, functions: 0, interfaces: 0, types: 0, variables: 0 },
        };
      },
      resolveModules(modules) {
        return modules.map((module) => {
          const resolvedImportMap = Object.fromEntries(
            module.imports.flatMap((specifier) => {
              const target = `${specifier.replaceAll('::', '/')}.fake`;
              return ctx.projectFiles.has(target) ? [[specifier, target]] : [];
            }),
          );
          return {
            ...module,
            resolvedImportMap,
            resolvedImports: Object.values(resolvedImportMap),
          };
        });
      },
      projectFacts: emptyProjectFacts,
    };
  },
};

function describeLanguageBackend(
  backend: LanguageBackend,
  files: Record<string, string>,
  entry: string,
  target: string,
): void {
  describe(`${backend.id} conformance`, () => {
    function discover(root: string, paths: string[], reused?: ModuleRecord[]): ModuleRecord[] {
      const session = backend.createSession(context(root, paths));
      const modules =
        reused ??
        paths
          .filter((path) => backend.extensions.has(path.slice(path.lastIndexOf('.'))))
          .filter((path) => ['source', 'test'].includes(backend.classifyFile(path)))
          .flatMap((path) => {
            const module = session.parseModule(path);
            return module ? [module] : [];
          });
      return session.resolveModules(modules).sort((a, b) => a.path.localeCompare(b.path));
    }
    it('is deterministic, reuses facts, resolves only existing targets, and does not execute source', () => {
      const root = tree(files);
      const marker = join(root, 'executed');
      // Both languages would create this marker if source were executed during analysis.
      const suffix =
        backend.id === 'python'
          ? `\nopen(${JSON.stringify(marker)}, "w").write("executed")\n`
          : backend.id === 'js-ts'
            ? `\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`
            : '\n';
      writeFileSync(join(root, entry), readFileSync(join(root, entry), 'utf8') + suffix);
      const paths = Object.keys(files).sort();
      const fresh = discover(root, paths);
      expect(discover(root, [...paths].reverse())).toEqual(fresh);
      expect(discover(root, paths, structuredClone(fresh))).toEqual(fresh);
      const module = fresh.find((item) => item.path === entry)!;
      expect(module.resolvedImports).toContain(target);
      for (const record of fresh)
        for (const resolved of record.resolvedImports) {
          expect(paths).toContain(resolved);
          expect(backend.extensions.has(resolved.slice(resolved.lastIndexOf('.')))).toBe(true);
        }
      expect(existsSync(marker)).toBe(false);
      expect(backend.collectedFacts).toContain('imports');
      if (backend.collectedFacts.includes('calls')) expect(module.calls).toContain('validate');
      else expect(module.calls).toEqual([]);
      if (backend.collectedFacts.includes('directives'))
        expect(module.directives).toContain('use client');
      else expect(module.directives).toEqual([]);
      expect(backend.collectedFacts.includes('packages')).toBe(backend.id !== 'fake');
    });
  });
}
const jsTs = languageRegistry.backends.find((backend) => backend.id === 'js-ts')!;
const python = languageRegistry.backends.find((backend) => backend.id === 'python')!;
describeLanguageBackend(
  jsTs,
  {
    'main.ts': `'use client';\nimport './lib/value';\nimport './other.py';\nvalidate();\n`,
    'lib/value.ts': 'export const value = 1;',
    'other.py': '',
  },
  'main.ts',
  'lib/value.ts',
);
describeLanguageBackend(
  python,
  {
    'main.py': 'from lib import value\nimport other\nvalidate()\n',
    'lib/__init__.py': '',
    'lib/value.py': '',
    'other.ts': '',
  },
  'main.py',
  'lib/value.py',
);
describeLanguageBackend(
  fakeBackend,
  { 'main.fake': '\nuse "lib::value"\n', 'lib/value.fake': '', 'other.ts': '' },
  'main.fake',
  'lib/value.fake',
);

it('rejects ambiguous extension ownership', () => {
  expect(() => createLanguageRegistry([fakeBackend, fakeBackend])).toThrow(
    'Duplicate language extension',
  );
});

it('integrates a third language with policy, impact and SARIF using only a test registry', async () => {
  const actual = await import('./index.js');
  const registry = createLanguageRegistry([fakeBackend]);
  vi.resetModules();
  vi.doMock('./index.js', () => ({
    ...actual,
    languageRegistry: registry,
    sourceLanguage: (path: string) => registry.forPath(path)?.id,
    collectedFacts: (path: string) => registry.forPath(path)?.collectedFacts ?? [],
  }));
  const { discoverProject } = await import('../discovery/discovery.js');
  const { scanGuard } = await import('../guard.js');
  const { analyzeProjectImpact } = await import('../analysis/impact.js');
  const { guardFindingsToSarif } = await import('../output/sarif.js');
  const root = tree({ 'entry/main.fake': '\nuse "lib::value"\n', 'lib/value.fake': '' });
  const model = discoverProject(root);
  expect(model.insights.dependencyEdges).toEqual([
    { from: 'entry/main.fake', to: 'lib/value.fake' },
  ]);
  const report = scanGuard(root, {
    version: 1,
    rules: [
      {
        id: 'no-lib',
        kind: 'forbidden-import',
        patterns: ['lib'],
        description: 'Boundary',
        severity: 'error',
      },
    ],
    contracts: [
      { id: 'validate', kind: 'required-call', mustCall: ['validate'], statement: 'Validate' },
    ],
  });
  expect(report.findings).toMatchObject([{ ruleId: 'no-lib', file: 'entry/main.fake', line: 2 }]);
  expect(report.notApplicable).toMatchObject([{ ruleId: 'contract:validate', modules: 2 }]);
  expect(analyzeProjectImpact(model, ['lib/value.fake']).dependents).toEqual(['entry/main.fake']);
  expect(model.insights.importResolution).toMatchObject([{ language: 'fake', resolved: 1 }]);
  expect(
    guardFindingsToSarif(report.findings).runs[0].results[0].locations![0].physicalLocation,
  ).toEqual({ artifactLocation: { uri: 'entry/main.fake' }, region: { startLine: 2 } });
});
