import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiscoveryLimitError,
  buildModuleTargetGraph,
  discoverProject,
  discoverProjectWithMetrics,
  clearDiscoveryCache,
  findGuardRoot,
  importResolutionStatus,
  pythonProjectRoots,
  type ModuleRecord,
  type ProjectModel,
} from './discovery.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('discoverProject', () => {
  it('fails explicitly when a project exceeds discovery limits', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-discovery-limits-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'limited' }));
    writeFileSync(join(root, 'entry.ts'), 'export const value = true;\n');

    expect(() => discoverProject(root, { maxFiles: 1 })).toThrow(DiscoveryLimitError);
    expect(() => discoverProject(root, { maxFileBytes: 1 })).toThrow(/maxFileBytes/);
  });

  it('stops recursive discovery as soon as the file limit is exceeded', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-discovery-early-limit-'));
    roots.push(root);
    mkdirSync(join(root, 'nested'), { recursive: true });
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      writeFileSync(join(root, 'nested', name), 'export const value = 1;\n');
    }

    expect(() => discoverProject(root, { maxFiles: 1 })).toThrow('discovery limit was reached');
  });

  it('invalidates the cache when content changes without size or mtime changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-cache-integrity-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cache-test' }));
    writeFileSync(join(root, 'entry.ts'), 'export const value = 1;\n');

    const first = discoverProject(root, { persistCache: false });
    const originalTimes = statSync(join(root, 'entry.ts'));
    writeFileSync(join(root, 'entry.ts'), 'export const value = 2;\n');
    utimesSync(join(root, 'entry.ts'), originalTimes.atime, originalTimes.mtime);

    const second = discoverProjectWithMetrics(root, { persistCache: false });

    expect(second.metrics.cacheHit).toBe(false);
    expect(second.metrics.reusedModules).toBe(0);
    expect(second.model.modules[0]?.contentHash).not.toBe(first.modules[0]?.contentHash);
  });

  it('builds a universal model from package metadata, source AST, tests, and patterns', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-discovery-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'example',
        packageManager: 'pnpm@11',
        scripts: { test: 'vitest', lint: 'eslint .' },
        dependencies: {
          next: 'latest',
          react: 'latest',
          vite: 'latest',
          stripe: 'latest',
          bullmq: 'latest',
          resend: 'latest',
        },
      }),
    );
    writeFileSync(
      join(root, 'page.tsx'),
      `'use client';\nimport React from 'react';\nexport function Page() { return null; }\n`,
    );
    writeFileSync(
      join(root, 'page.test.ts'),
      `import { test } from 'vitest';\ntest('page', () => {});\n`,
    );
    writeFileSync(join(root, 'schema.ts'), `export type User = { id: string };\n`);
    writeFileSync(join(root, 'env.ts'), `export const url = process.env.DATABASE_URL;\n`);
    writeFileSync(join(root, '.env.example'), 'DATABASE_URL=\n');
    writeFileSync(join(root, 'next.config.mjs'), `export default {};\n`);
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(
      join(root, 'app/route.ts'),
      `export async function GET() { return new Response('ok'); }\nexport const POST = async () => new Response('ok');\n`,
    );
    mkdirSync(join(root, 'content'), { recursive: true });
    writeFileSync(join(root, 'content/configuration.mdx'), '# Configuration\n');
    writeFileSync(join(root, '.env.local'), 'SECRET=value\n');
    writeFileSync(join(root, 'local.db'), 'database\n');
    writeFileSync(join(root, 'tsconfig.tsbuildinfo'), '{}\n');
    writeFileSync(join(root, 'a.ts'), `import { b } from './b'; export const a = b;\n`);
    writeFileSync(join(root, 'b.ts'), `import { a } from './a'; export const b = a;\n`);
    writeFileSync(
      join(root, 'dynamic.ts'),
      `export const lazy = () => import('./b');\nexport const required = require('./a');\n`,
    );

    const model = discoverProject(root);

    expect(model.project.name).toBe('example');
    expect(model.project.frameworks).toEqual(['Next.js', 'React']);
    expect(model.project.workspacePackages).toEqual([]);
    expect(model.tests.files).toEqual(['page.test.ts']);
    expect(model.configs).toContain('next.config.mjs');
    expect(model.configs).not.toContain('content/configuration.mdx');
    expect(model.schemas).toEqual(['schema.ts']);
    expect(model.insights.envReferences).toEqual([
      { name: 'DATABASE_URL', files: ['env.ts'], declared: true },
    ]);
    expect(model.files.map((file) => file.path)).not.toEqual(
      expect.arrayContaining(['.env.local', 'local.db', 'tsconfig.tsbuildinfo']),
    );
    expect(model.patterns.clientComponents).toEqual(['page.tsx']);
    expect(model.patterns.routeHandlers).toEqual(['app/route.ts']);
    expect(model.patterns.routeDetails).toEqual([
      { path: 'app/route.ts', methods: ['GET', 'POST'] },
    ]);
    const routeImpact = model.insights.impactPaths.find(
      (impact) => impact.entrypoint === 'app/route.ts',
    );
    expect(routeImpact?.files).toContain('app/route.ts');
    expect(routeImpact?.layers).toContain('routes');
    expect(model.capabilities.payments.packages).toEqual(['stripe']);
    expect(model.capabilities.payments.status).toBe('inferred');
    expect(model.capabilities.jobs.packages).toEqual(['bullmq']);
    expect(model.capabilities.email.packages).toEqual(['resend']);
    expect(model.patterns.importGraphEdges).toBeGreaterThan(0);
    expect(model.insights.cycles).toEqual([['a.ts', 'b.ts']]);
    expect(model.git.history).toEqual([]);
    expect(
      model.insights.dependencyEdges.some((edge) => edge.from === 'a.ts' && edge.to === 'b.ts'),
    ).toBe(true);
    expect(
      model.insights.dependencyEdges.some((edge) => edge.from === 'b.ts' && edge.to === 'a.ts'),
    ).toBe(true);
    expect(model.insights.layers.other).toContain('a.ts');
    expect(model.modules.find((module) => module.path === 'dynamic.ts')).toMatchObject({
      dynamicImports: ['./a', './b'],
    });
    expect(model.insights.importHotspots[0]).toMatchObject({ module: 'react', count: 1 });
    expect(model.modules.find((module) => module.path === 'page.tsx')).toMatchObject({
      imports: ['react'],
      declarations: { functions: 1 },
      directives: ['use client'],
    });
  });

  it('records nested workspace package boundaries and their scripts', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-workspace-'));
    roots.push(root);
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    mkdirSync(join(root, 'packages/core'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'] }),
    );
    writeFileSync(
      join(root, 'apps/web/package.json'),
      JSON.stringify({
        name: '@example/web',
        scripts: { build: 'vite' },
        dependencies: { react: '^1' },
      }),
    );
    writeFileSync(
      join(root, 'packages/core/package.json'),
      JSON.stringify({
        name: '@example/core',
        private: true,
        exports: { '.': './dist/index.js', './db': './dist/db.js' },
        dependencies: { zod: '^1' },
      }),
    );
    writeFileSync(
      join(root, 'packages/core/tsconfig.json'),
      JSON.stringify({ references: [{ path: '../shared' }] }),
    );

    const model = discoverProject(root);

    expect(model.project.workspacePackages).toEqual([
      expect.objectContaining({ path: 'apps/web', name: '@example/web', private: false }),
      expect.objectContaining({
        path: 'packages/core',
        name: '@example/core',
        private: true,
        exports: ['.', './db'],
        projectReferences: ['../shared'],
      }),
    ]);
  });

  it('loads package-level tsconfig files in monorepos', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-monorepo-tsconfig-'));
    roots.push(root);
    mkdirSync(join(root, 'packages/web/src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
    writeFileSync(
      join(root, 'packages/web/tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@web/*': ['src/*'] } },
        include: ['src/**/*.ts'],
      }),
    );
    writeFileSync(
      join(root, 'packages/web/package.json'),
      JSON.stringify({ name: '@example/web' }),
    );
    writeFileSync(join(root, 'packages/web/src/db.ts'), 'export const db = true;\n');
    writeFileSync(
      join(root, 'packages/web/src/page.ts'),
      `import { db } from '@web/db'; export const page = db;\n`,
    );

    const model = discoverProject(root);

    expect(
      model.modules.find((module) => module.path === 'packages/web/src/page.ts')?.resolvedImports,
    ).toEqual(['packages/web/src/db.ts']);
  });

  it('resolves tsconfig aliases, re-exports, imported symbols, and calls through ts-morph', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-tsconfig-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'aliases', scripts: {} }));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
        include: ['src/**/*.ts'],
      }),
    );
    writeFileSync(join(root, 'src/a.ts'), `export function loadUser() { return null; }\n`);
    writeFileSync(
      join(root, 'src/b.ts'),
      `import { loadUser as getUser } from '@/a'; export const user = getUser();\n`,
    );
    writeFileSync(join(root, 'src/index.ts'), `export { loadUser } from '@/a';\n`);

    const model = discoverProject(root);
    const module = model.modules.find((item) => item.path === 'src/b.ts');

    expect(module?.resolvedImports).toEqual(['src/a.ts']);
    expect(module?.importedSymbols).toEqual(['getUser']);
    expect(module?.calls).toContain('getUser');
    expect(model.insights.dependencyEdges).toContainEqual({ from: 'src/b.ts', to: 'src/a.ts' });
  });

  it('records the first line of each import, preferring static imports over re-exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-import-lines-'));
    roots.push(root);
    writeFileSync(
      join(root, 'entry.ts'),
      [
        `export { shared } from './shared';`,
        `// comment`,
        `import { shared as local } from './shared';`,
        `import {`,
        `  value,`,
        `} from './multiline';`,
        `export * from './barrel';`,
        `export const load = () => import('./lazy');`,
        `const legacy = require('./legacy');`,
        `import './multiline';`,
        `export const all = [local, value, legacy];`,
      ].join('\n'),
    );

    const module = discoverProject(root).modules.find((item) => item.path === 'entry.ts');

    expect(module?.importLines).toEqual({
      './shared': 3,
      './multiline': 4,
      './barrel': 7,
      './lazy': 8,
      './legacy': 9,
    });
  });

  it('never resolves a JS/TS import to a Python file', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-cross-language-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    writeFileSync(join(root, 'src/tool.py'), 'import os\n');
    writeFileSync(join(root, 'src/helper.ts'), 'export const helper = true;\n');
    writeFileSync(
      join(root, 'src/entry.ts'),
      [
        `export const relative = () => import('./tool.py');`,
        `export const aliased = () => import('@/tool.py');`,
        `export const helper = () => import('./helper');`,
      ].join('\n'),
    );

    const module = discoverProject(root).modules.find((item) => item.path === 'src/entry.ts');

    expect(module?.resolvedImports).toEqual(['src/helper.ts']);
  });

  it('separates unresolved local imports from external packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-import-status-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'packages/shared'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'status', private: true, workspaces: ['packages/*'] }),
    );
    writeFileSync(
      join(root, 'packages/shared/package.json'),
      JSON.stringify({ name: '@status/shared' }),
    );
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'], '*': ['types/*'] } },
      }),
    );
    writeFileSync(join(root, 'src/helper.ts'), 'export const helper = true;\n');
    writeFileSync(join(root, 'src/styles.css'), 'body {}\n');
    writeFileSync(
      join(root, 'src/entry.ts'),
      [
        `import { helper } from './helper';`,
        `import './styles.css';`,
        `import { missing } from './missing';`,
        `import { aliased } from '@/nothing';`,
        `import { shared } from '@status/shared/utils';`,
        `import React from 'react';`,
        `import { readFileSync } from 'node:fs';`,
        `export { gone } from './gone';`,
        `export const lazy = () => import('./lazy-missing');`,
        `export const all = [helper, missing, aliased, shared, React, readFileSync];`,
      ].join('\n'),
    );

    const module = discoverProject(root).modules.find((item) => item.path === 'src/entry.ts');
    if (!module) throw new Error('entry module was not discovered');

    expect(module.unresolvedImports).toEqual([
      './gone',
      './lazy-missing',
      './missing',
      '@/nothing',
      '@status/shared/utils',
    ]);
    expect(
      Object.fromEntries(
        ['./helper', './styles.css', './missing', '@/nothing', 'react', 'node:fs'].map(
          (specifier) => [specifier, importResolutionStatus(module, specifier)],
        ),
      ),
    ).toEqual({
      './helper': 'resolved',
      './styles.css': 'resolved',
      './missing': 'unresolved',
      '@/nothing': 'unresolved',
      react: 'external',
      'node:fs': 'external',
    });
  });

  it('resolves directory requires to the project root and to nested directory indexes', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-directory-requires-'));
    roots.push(root);
    mkdirSync(join(root, 'test'), { recursive: true });
    mkdirSync(join(root, 'examples/app'), { recursive: true });
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'index.js'), `module.exports = require('./lib');\n`);
    writeFileSync(join(root, 'lib/index.js'), 'module.exports = {};\n');
    writeFileSync(
      join(root, 'test/app.js'),
      `const a = require('..');\nconst b = require('../');\n`,
    );
    writeFileSync(
      join(root, 'examples/app/index.js'),
      `const root = require('../..');\nconst lib = require('../../lib/');\n`,
    );

    const model = discoverProject(root);
    const resolved = (path: string): string[] | undefined =>
      model.modules.find((item) => item.path === path)?.resolvedImports;

    expect(resolved('test/app.js')).toEqual(['index.js']);
    expect(resolved('examples/app/index.js')).toEqual(['index.js', 'lib/index.js']);
    expect(model.modules.every((item) => (item.unresolvedImports ?? []).length === 0)).toBe(true);
  });

  it('applies the relative-path graph fallback only to JS/TS modules', () => {
    const record = (
      path: string,
      imports: string[],
      resolvedImports: string[] = [],
    ): ModuleRecord => ({
      path,
      contentHash: '',
      imports,
      importedSymbols: [],
      exports: [],
      calls: [],
      resolvedImports,
      dynamicImports: [],
      declarations: { classes: 0, functions: 0, interfaces: 0, types: 0, variables: 0 },
      directives: [],
    });

    const graph = buildModuleTargetGraph([
      record('pkg/views.py', ['.', '..models', '.helpers'], ['pkg/models.py']),
      record('pkg/models.py', []),
      record('pkg/index.ts', ['./views.py', './util']),
      record('pkg/util.ts', []),
      record('models.ts', []),
      record('pkg/.helpers.ts', []),
    ]);

    expect(graph.get('pkg/views.py')).toEqual(['pkg/models.py']);
    expect(graph.get('pkg/index.ts')).toEqual(['pkg/util.ts']);
  });

  it('keeps AST-resolved and fallback edges when a module mixes aliases and relative imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-mixed-graph-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mixed-graph' }));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
        include: ['src/**/*.ts'],
      }),
    );
    writeFileSync(join(root, 'src/alias.ts'), 'export const alias = true;\n');
    writeFileSync(join(root, 'src/relative.ts'), 'export const relative = true;\n');
    writeFileSync(
      join(root, 'src/entry.ts'),
      `import { alias } from '@/alias';\nimport { relative } from './relative';\nexport { alias, relative };\n`,
    );

    const model = discoverProject(root);
    expect(model.insights.dependencyEdges).toEqual(
      expect.arrayContaining([
        { from: 'src/entry.ts', to: 'src/alias.ts' },
        { from: 'src/entry.ts', to: 'src/relative.ts' },
      ]),
    );
  });

  it('uses AST for route exports and environment references, ignoring comments and strings', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-adversarial-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'adversarial' }));
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(
      join(root, 'app/route.ts'),
      `// export function DELETE() {}
const handler = async () => new Response('ok');
export { handler as POST };
const text = "export function PUT() {}";
`,
    );
    writeFileSync(
      join(root, 'env.ts'),
      `const ignored = 'process.env.NOT_A_REFERENCE';
export const url = process.env.DATABASE_URL;
export const key = process.env['API_KEY'];
`,
    );

    const model = discoverProject(root);

    expect(model.patterns.routeDetails).toEqual([{ path: 'app/route.ts', methods: ['POST'] }]);
    expect(model.insights.envReferences).toEqual([
      { name: 'API_KEY', files: ['env.ts'], declared: false },
      { name: 'DATABASE_URL', files: ['env.ts'], declared: false },
    ]);
  });

  it('does not follow symlinks and reports deleted and renamed Git paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-git-adversarial-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'git-fixture' }));
    writeFileSync(join(root, 'original.ts'), 'export const value = 1;\n');
    mkdirSync(join(root, 'outside'), { recursive: true });
    writeFileSync(join(root, 'outside/secret.ts'), 'export const secret = true;\n');
    symlinkSync(join(root, 'outside'), join(root, 'linked-outside'));

    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'guard@example.test']);
    git(['config', 'user.name', 'Guard Test']);
    git(['add', '.']);
    git(['commit', '-qm', 'initial']);
    git(['mv', 'original.ts', 'renamed.ts']);
    rmSync(join(root, 'outside/secret.ts'));

    const model = discoverProject(root);

    expect(model.files.map((file) => file.path)).not.toContain('linked-outside/secret.ts');
    expect(model.git.changedFiles).toEqual(
      expect.arrayContaining(['renamed.ts', 'outside/secret.ts']),
    );
  });

  it('keeps external declaration files out of the internal dependency graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-external-'));
    roots.push(root);
    mkdirSync(join(root, 'node_modules/external'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'external', scripts: {} }));
    writeFileSync(
      join(root, 'node_modules/external/index.d.ts'),
      'export declare const x: string;',
    );
    writeFileSync(join(root, 'index.ts'), `import { x } from 'external'; export { x };\n`);

    const model = discoverProject(root);

    expect(model.insights.dependencyEdges.every((edge) => !edge.to.includes('node_modules'))).toBe(
      true,
    );
  });

  it('persists a cache only for initialized projects and invalidates it after edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-cache-'));
    roots.push(root);
    mkdirSync(join(root, '.codapult/guard'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cache', scripts: {} }));
    writeFileSync(join(root, 'index.ts'), 'export const value = 1;\n');

    const first = discoverProject(root);
    expect(existsSync(join(root, '.codapult/guard/cache.json'))).toBe(true);
    const second = discoverProject(root);
    expect(second).toBe(first);
    writeFileSync(join(root, 'index.ts'), 'export const value = 200;\n');

    expect(discoverProject(root)).not.toBe(first);

    const cachePath = join(root, '.codapult/guard/cache.json');
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    writeFileSync(cachePath, JSON.stringify({ ...cache, version: 1 }));
    writeFileSync(join(root, 'package.json'), '{\n  "name": "cache",\n  "scripts": {}\n}\n');
    discoverProject(root);
    const refreshedCache = JSON.parse(readFileSync(cachePath, 'utf8')) as { version?: unknown };
    expect(refreshedCache.version).toBe(7);
  });

  it('does not persist discovery cache through a symlinked Guard directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-cache-linked-'));
    const outside = mkdtempSync(join(tmpdir(), 'guard-cache-outside-'));
    roots.push(root, outside);
    symlinkSync(outside, join(root, '.codapult'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cache-linked' }));
    writeFileSync(join(root, 'index.ts'), 'export const value = 1;\n');

    discoverProject(root, { persistCache: true });

    expect(existsSync(join(outside, 'guard/cache.json'))).toBe(false);
  });

  it('returns bounded analysis metrics without changing the project model shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-metrics-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'metrics', scripts: {} }));
    writeFileSync(join(root, 'index.ts'), 'export const value = 1;\n');

    const result = discoverProjectWithMetrics(root);

    expect(result.model.version).toBe(1);
    expect(result.metrics).toMatchObject({
      files: 2,
      modules: 1,
      cacheAvailable: false,
      cacheHit: false,
      changedFiles: 0,
    });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);

    writeFileSync(join(root, 'index.ts'), 'export const value = 2;\n');
    const refreshed = discoverProjectWithMetrics(root);
    expect(refreshed.metrics.reusedModules).toBe(0);
    writeFileSync(join(root, 'README.md'), '# unchanged source set\n');
    const metadataRefresh = discoverProjectWithMetrics(root);
    expect(metadataRefresh.metrics.reusedModules).toBe(1);
  });
});

/** Discovery in a fresh module instance, so only the persisted cache carries over, as in a new process. */
async function discoverInFreshProcess(root: string): Promise<ProjectModel> {
  vi.resetModules();
  const fresh = await import('./discovery.js');
  return fresh.discoverProject(root, { persistCache: true });
}

function resolutionView(model: ProjectModel): unknown {
  return {
    modules: model.modules.map((module) => ({
      path: module.path,
      resolvedImportMap: module.resolvedImportMap,
      unresolvedImports: module.unresolvedImports,
    })),
    edges: model.insights.dependencyEdges,
  };
}

function aliasProject(prefix: string): string {
  // TypeScript reports symlink targets by real path, and the macOS temp directory is a symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  mkdirSync(join(root, 'a'), { recursive: true });
  mkdirSync(join(root, 'b'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'alias-cache' }));
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['a/*'] } } }),
  );
  writeFileSync(join(root, 'a/lib.ts'), 'export const lib = "a";\n');
  writeFileSync(join(root, 'b/lib.ts'), 'export const lib = "b";\n');
  writeFileSync(join(root, 'entry.ts'), "import { lib } from '@lib/lib';\nexport { lib };\n");
  return root;
}

function retargetAlias(root: string): void {
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['b/*'] } } }),
  );
}

describe('discovery cache and resolution inputs', () => {
  it('re-resolves imports after a committed tsconfig alias change', async () => {
    const root = aliasProject('guard-cache-committed-alias-');
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'guard@example.test']);
    git(['config', 'user.name', 'Guard Test']);
    git(['add', '.']);
    git(['commit', '-qm', 'initial']);
    const before = await discoverInFreshProcess(root);
    expect(before.modules.find((module) => module.path === 'entry.ts')?.resolvedImports).toEqual([
      'a/lib.ts',
    ]);

    retargetAlias(root);
    git(['commit', '-qam', 'retarget alias']);
    const after = await discoverInFreshProcess(root);

    expect(after.modules.find((module) => module.path === 'entry.ts')?.resolvedImports).toEqual([
      'b/lib.ts',
    ]);
  });

  it('re-resolves imports after a tsconfig alias change in a project without git', async () => {
    const root = aliasProject('guard-cache-nogit-alias-');
    await discoverInFreshProcess(root);

    retargetAlias(root);
    const inProcess = discoverProject(root, { persistCache: true });
    const fresh = await discoverInFreshProcess(root);

    for (const model of [inProcess, fresh]) {
      expect(model.modules.find((module) => module.path === 'entry.ts')?.resolvedImports).toEqual([
        'b/lib.ts',
      ]);
    }
  });

  it('keeps reused modules consistent with a cold discovery across resolution edits', async () => {
    const root = aliasProject('guard-cache-consistency-');
    mkdirSync(join(root, 'packages/shared/src'), { recursive: true });
    mkdirSync(join(root, 'node_modules/@demo'), { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          module: 'esnext',
          moduleResolution: 'bundler',
          paths: { '@lib/*': ['a/*'] },
        },
      }),
    );
    writeFileSync(
      join(root, 'packages/shared/package.json'),
      JSON.stringify({ name: '@demo/shared', exports: { '.': './src/one.ts' } }),
    );
    writeFileSync(join(root, 'packages/shared/src/one.ts'), 'export const shared = 1;\n');
    writeFileSync(join(root, 'packages/shared/src/two.ts'), 'export const shared = 2;\n');
    symlinkSync(join(root, 'packages/shared'), join(root, 'node_modules/@demo/shared'));
    writeFileSync(
      join(root, 'consumer.ts'),
      [
        "import { lib } from '@lib/lib';",
        "import { shared } from '@demo/shared';",
        "import { later } from './later';",
        "import './styles.css';",
        'export { lib, shared, later };',
        '',
      ].join('\n'),
    );
    const cold = async (): Promise<ProjectModel> => {
      clearDiscoveryCache(root);
      const model = await discoverInFreshProcess(root);
      clearDiscoveryCache(root);
      return model;
    };
    const edits: [string, () => void][] = [
      [
        'alias retarget',
        () => {
          const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
            compilerOptions: { paths: Record<string, string[]> };
          };
          tsconfig.compilerOptions.paths['@lib/*'] = ['b/*'];
          writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
        },
      ],
      [
        'package.json exports change',
        () =>
          writeFileSync(
            join(root, 'packages/shared/package.json'),
            JSON.stringify({ name: '@demo/shared', exports: { '.': './src/two.ts' } }),
          ),
      ],
      [
        'source file added',
        () => writeFileSync(join(root, 'later.ts'), 'export const later = 1;\n'),
      ],
      ['asset added', () => writeFileSync(join(root, 'styles.css'), 'body {}\n')],
      ['source file removed', () => rmSync(join(root, 'later.ts'))],
    ];

    await discoverInFreshProcess(root);
    for (const [name, edit] of edits) {
      edit();
      const inProcess = discoverProject(root, { persistCache: true });
      const fresh = await discoverInFreshProcess(root);
      const expected = resolutionView(await cold());
      expect(resolutionView(inProcess), name).toEqual(expected);
      expect(resolutionView(fresh), name).toEqual(expected);
      // Seed the persisted cache for the next edit.
      await discoverInFreshProcess(root);
    }
    const consumer = discoverProject(root).modules.find((module) => module.path === 'consumer.ts');
    expect(consumer?.resolvedImportMap).toMatchObject({
      '@lib/lib': 'b/lib.ts',
      '@demo/shared': 'packages/shared/src/two.ts',
    });
    expect(consumer?.unresolvedImports).toEqual(['./later']);
  });

  it('keeps reusing modules when only files outside resolution inputs change', async () => {
    const root = aliasProject('guard-cache-reuse-');
    await discoverInFreshProcess(root);
    writeFileSync(join(root, 'notes.md'), '# notes\n');
    writeFileSync(join(root, 'a/lib.ts'), 'export const lib = "a2";\n');

    vi.resetModules();
    const fresh = await import('./discovery.js');
    const result = fresh.discoverProjectWithMetrics(root, { persistCache: true });

    expect(result.metrics.cacheHit).toBe(false);
    expect(result.metrics.reusedModules).toBe(2);
  });
});

function writeTree(root: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

describe('Python project discovery', () => {
  it('classifies Python sources, tests, and manifests and skips environments and caches', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-only-'));
    roots.push(root);
    writeTree(root, {
      'pyproject.toml': '[project]\nname = "demo"\n',
      'requirements.txt': 'requests\n',
      'requirements-dev.txt': 'pytest\n',
      'tox.ini': '[tox]\n',
      'poetry.lock': '',
      Pipfile: '',
      'README.md': '# demo\n',
      'src/demo/__init__.py': '',
      'src/demo/config.py': 'DEBUG = False\n',
      'src/demo/schemas.py': 'class User: ...\n',
      'src/demo/services/billing.py': 'import stripe\n',
      'src/demo/billing_test.py': '',
      'src/demo/test_models.py': '',
      'src/demo/testing.py': '',
      'src/demo/latest.py': '',
      'src/demo/migrations/0001_initial.py': '',
      'tests/conftest.py': '',
      'tests/unit/helpers.py': '',
      'noxfile.py': '',
      'setup.py': '',
      '.venv/lib/python3.12/site-packages/requests/__init__.py': '',
      'venv/lib/site.py': '',
      'src/demo/__pycache__/config.cpython-312.pyc': '',
      'src/demo/stale.pyc': '',
      'src/demo.egg-info/PKG-INFO': '',
      '.tox/py312/lib/site.py': '',
      '.mypy_cache/3.12/demo.json': '',
      '.pytest_cache/v/cache/lastfailed': '',
      '.ruff_cache/content': '',
      '.eggs/README.txt': '',
      '.nox/lint/bin/python.py': '',
    });

    const model = discoverProject(root, { persistCache: false });
    const kinds = Object.fromEntries(model.files.map((file) => [file.path, file.kind]));

    expect(kinds).toEqual({
      'pyproject.toml': 'config',
      'requirements.txt': 'config',
      'requirements-dev.txt': 'config',
      'tox.ini': 'config',
      'poetry.lock': 'config',
      Pipfile: 'config',
      'README.md': 'documentation',
      'src/demo/__init__.py': 'source',
      'src/demo/config.py': 'source',
      'src/demo/schemas.py': 'source',
      'src/demo/services/billing.py': 'source',
      'src/demo/billing_test.py': 'test',
      'src/demo/test_models.py': 'test',
      'src/demo/testing.py': 'source',
      'src/demo/latest.py': 'source',
      'src/demo/migrations/0001_initial.py': 'migration',
      'tests/conftest.py': 'test',
      'tests/unit/helpers.py': 'test',
      'noxfile.py': 'source',
      'setup.py': 'source',
    });
    expect(model.tests.files).toEqual([
      'src/demo/billing_test.py',
      'src/demo/test_models.py',
      'tests/conftest.py',
      'tests/unit/helpers.py',
    ]);
    expect(model.insights.layers.tests).toEqual(model.tests.files);
    expect(model.insights.layers.application).toEqual(['src/demo/services/billing.py']);
    expect(pythonProjectRoots(model.files.map((file) => file.path))).toEqual(['.']);
  });

  it('keeps JS/TS classification unchanged for the Python test rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-js-tests-'));
    roots.push(root);
    writeTree(root, {
      'package.json': JSON.stringify({ name: 'web' }),
      'tests/helpers.ts': 'export const helper = 1;\n',
      'src/test_utils.ts': 'export const util = 1;\n',
      'src/schema.ts': 'export const schema = 1;\n',
      'docs/notes.txt': 'notes\n',
    });

    const model = discoverProject(root, { persistCache: false });
    const kinds = Object.fromEntries(model.files.map((file) => [file.path, file.kind]));

    expect(kinds).toMatchObject({
      'tests/helpers.ts': 'source',
      'src/test_utils.ts': 'source',
      'src/schema.ts': 'schema',
      'docs/notes.txt': 'documentation',
    });
    expect(model.insights.layers.tests).toBeUndefined();
  });

  it('retains both languages in a mixed project and lists nested Python roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-mixed-'));
    roots.push(root);
    writeTree(root, {
      'package.json': JSON.stringify({ name: 'mixed', private: true }),
      'web/src/app.ts': "import { api } from './api';\nexport const app = api;\n",
      'web/src/api.ts': 'export const api = 1;\n',
      'services/api/pyproject.toml': '',
      'services/api/app/main.py': 'from app import routes\n',
      'services/api/app/routes.py': '',
      'services/worker/setup.cfg': '',
      'services/worker/worker.py': '',
      'libs/legacy/setup.py': '',
      'services/api/.venv/lib/pkg/pyproject.toml': '',
    });

    const model = discoverProject(root, { persistCache: false });

    expect(model.files.filter((file) => file.kind === 'source').map((file) => file.path)).toEqual([
      'libs/legacy/setup.py',
      'services/api/app/main.py',
      'services/api/app/routes.py',
      'services/worker/worker.py',
      'web/src/api.ts',
      'web/src/app.ts',
    ]);
    expect(model.modules.map((module) => module.path)).toEqual([
      'libs/legacy/setup.py',
      'services/api/app/main.py',
      'services/api/app/routes.py',
      'services/worker/worker.py',
      'web/src/api.ts',
      'web/src/app.ts',
    ]);
    expect(model.insights.dependencyEdges).toEqual([
      { from: 'services/api/app/main.py', to: 'services/api/app/routes.py' },
      { from: 'web/src/app.ts', to: 'web/src/api.ts' },
    ]);
    expect(pythonProjectRoots(model.files.map((file) => file.path))).toEqual([
      'libs/legacy',
      'services/api',
      'services/worker',
    ]);
  });

  it('stops at the nearest ancestor with a JS/TS or Python project marker', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-python-root-')));
    roots.push(root);
    writeTree(root, {
      'package.json': JSON.stringify({ name: 'monorepo' }),
      'services/api/pyproject.toml': '',
      'services/api/app/routes/users.py': '',
      'services/worker/setup.cfg': '',
      'services/worker/jobs/send.py': '',
      'libs/legacy/setup.py': '',
      'libs/legacy/legacy/core.py': '',
      'services/plain/module.py': '',
      'web/package.json': JSON.stringify({ name: 'web' }),
      'web/pyproject.toml': '',
      'web/src/app.ts': '',
    });

    expect(findGuardRoot(join(root, 'services/api/app/routes'))).toBe(join(root, 'services/api'));
    expect(findGuardRoot(join(root, 'services/api'))).toBe(join(root, 'services/api'));
    expect(findGuardRoot(join(root, 'services/worker/jobs'))).toBe(join(root, 'services/worker'));
    expect(findGuardRoot(join(root, 'libs/legacy/legacy'))).toBe(join(root, 'libs/legacy'));
    expect(findGuardRoot(join(root, 'services/plain'))).toBe(root);
    expect(findGuardRoot(join(root, 'web/src'))).toBe(join(root, 'web'));
  });
});

describe('Python module parsing', () => {
  it('records Python import facts, lines, symbols, and declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-parse-'));
    roots.push(root);
    writeTree(root, {
      'pyproject.toml': '',
      'app/views.py': [
        'from __future__ import annotations',
        'import os.path as osp',
        'from .db import models, session as db',
        'from typing import TYPE_CHECKING',
        'if TYPE_CHECKING:',
        '    from app.services import UserService',
        'def handler():',
        '    from .db import cache',
        '    return cache',
        'class View: pass',
        'LIMIT = 10',
        '',
      ].join('\n'),
    });

    const model = discoverProject(root, { persistCache: false });
    const views = model.modules.find((module) => module.path === 'app/views.py');

    expect(views).toMatchObject({
      imports: ['.db', '__future__', 'app.services', 'os.path', 'typing'],
      importedSymbols: [
        'TYPE_CHECKING',
        'UserService',
        'annotations',
        'cache',
        'db',
        'models',
        'osp',
      ],
      importLines: {
        __future__: 1,
        'os.path': 2,
        '.db': 3,
        typing: 4,
        'app.services': 6,
      },
      exports: [],
      dynamicImports: [],
      calls: [],
      directives: [],
      declarations: { classes: 1, functions: 1, interfaces: 0, types: 0, variables: 1 },
    });
    expect(views?.pythonImports).toEqual([
      { module: '__future__', names: ['annotations'], line: 1 },
      { module: 'os.path', line: 2 },
      { module: '.db', names: ['models', 'session'], line: 3 },
      { module: 'typing', names: ['TYPE_CHECKING'], line: 4 },
      { module: 'app.services', names: ['UserService'], line: 6 },
      { module: '.db', names: ['cache'], line: 8 },
    ]);
    expect(views?.parseDiagnostics).toBeUndefined();
    // Resolution (Task 05) finds no target: app/db and app/services.py do not exist.
    expect(views?.resolvedImportMap).toEqual({});
    expect(views?.unresolvedImports).toEqual(['.db', 'app.services']);
    expect(importResolutionStatus(views!, '.db')).toBe('unresolved');
    expect(importResolutionStatus(views!, 'os.path')).toBe('external');
    expect(model.insights.dependencyEdges).toEqual([]);
  });

  it('keeps a malformed Python module with diagnostics and discovers the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-malformed-'));
    roots.push(root);
    writeTree(root, {
      'pyproject.toml': '',
      'app/broken.py': 'import before\ndef broken(:\n    pass\nfrom import ghost\nimport after\n',
      'app/fine.py': 'import json\n',
    });

    const model = discoverProject(root, { persistCache: false });
    const broken = model.modules.find((module) => module.path === 'app/broken.py');

    expect(model.modules.map((module) => module.path)).toEqual(['app/broken.py', 'app/fine.py']);
    expect(broken?.imports).toEqual(['after', 'before']);
    expect(broken?.parseDiagnostics?.length).toBeGreaterThan(0);
    expect(broken?.parseDiagnostics?.length).toBeLessThanOrEqual(5);
  });

  it('does not load the Python parser for a project without Python files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-lazy-'));
    roots.push(root);
    writeTree(root, {
      'package.json': JSON.stringify({ name: 'ts-only' }),
      'src/index.ts': "import { value } from './value';\nexport { value };\n",
      'src/value.ts': 'export const value = 1;\n',
    });
    vi.resetModules();
    const discovery = await import('./discovery.js');
    const parser = await import('./python-imports.js');

    discovery.discoverProject(root, { persistCache: false });
    expect(parser.isPythonParserLoaded()).toBe(false);

    writeFileSync(join(root, 'src/tool.py'), 'import os\n');
    discovery.discoverProject(root, { persistCache: false });
    expect(parser.isPythonParserLoaded()).toBe(true);
  });
});

describe('Python import resolution in discovery', () => {
  it('builds Python edges, cycles, statuses, and hotspots of external packages only', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-graph-'));
    roots.push(root);
    writeTree(root, {
      'pyproject.toml': '',
      'app/__init__.py': '',
      'app/services.py': 'import requests\nfrom app import repository\n',
      'app/repository.py': 'import requests\nfrom .services import helper\n',
      'app/views.py': 'from app import services\nimport app.services\nimport requests\n',
      'web/index.ts': "import { x } from './x';\n",
      'web/x.ts': 'export const x = 1;\n',
      'web/x.py': '',
    });

    const model = discoverProject(root, { persistCache: false });
    const views = model.modules.find((module) => module.path === 'app/views.py')!;

    expect(model.insights.dependencyEdges).toEqual([
      { from: 'app/repository.py', to: 'app/services.py' },
      { from: 'app/services.py', to: 'app/repository.py' },
      { from: 'app/views.py', to: 'app/services.py' },
      { from: 'web/index.ts', to: 'web/x.ts' },
    ]);
    expect(model.insights.cycles).toEqual([['app/repository.py', 'app/services.py']]);
    expect(importResolutionStatus(views, 'app')).toBe('resolved');
    expect(importResolutionStatus(views, 'app.services')).toBe('resolved');
    expect(importResolutionStatus(views, 'requests')).toBe('external');
    expect(model.insights.importHotspots).toEqual([{ module: 'requests', count: 3 }]);
    expect(
      model.modules.find((module) => module.path === 'app/repository.py')?.canonicalImports,
    ).toEqual({ '.services': 'app.services' });
  });

  it('re-resolves reused Python records when files and project roots change', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-python-fresh-')));
    roots.push(root);
    writeTree(root, {
      'main.py': 'import billing.service\nfrom shared import util\n',
      'shared/__init__.py': '',
    });
    await discoverInFreshProcess(root);

    writeTree(root, { 'billing/service.py': '' });
    const added = discoverProjectWithMetrics(root, { persistCache: true });
    const fresh = await discoverInFreshProcess(root);
    for (const model of [added.model, fresh]) {
      expect(model.modules.find((module) => module.path === 'main.py')?.resolvedImportMap).toEqual({
        'billing.service': 'billing/service.py',
        shared: 'shared/__init__.py',
      });
    }
    expect(added.metrics.reusedModules).toBeGreaterThan(0);

    // A nested project root with its own regular `shared` package now wins for files inside it.
    writeTree(root, {
      'tools/pyproject.toml': '',
      'tools/cli.py': 'from shared import util\n',
      'tools/shared/__init__.py': '',
      'tools/shared/util.py': '',
    });
    const rooted = await discoverInFreshProcess(root);
    expect(
      rooted.modules.find((module) => module.path === 'tools/cli.py')?.resolvedImportMap,
    ).toEqual({ 'shared.util': 'tools/shared/util.py' });

    rmSync(join(root, 'billing/service.py'));
    const removed = await discoverInFreshProcess(root);
    const main = removed.modules.find((module) => module.path === 'main.py');
    expect(main?.resolvedImportMap).toEqual({ shared: 'shared/__init__.py' });
    expect(main?.unresolvedImports).toEqual([]);
    expect(importResolutionStatus(main!, 'billing.service')).toBe('external');
  });
});
