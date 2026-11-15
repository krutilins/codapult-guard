import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEcosystemRegistry } from './index.js';
import type { EcosystemProvider } from './types.js';
const roots: string[] = [];
afterEach(() => {
  vi.doUnmock('./index.js');
  vi.resetModules();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const fake: EcosystemProvider = {
  id: 'fake-project',
  signals: {
    frameworks: [{ dependency: 'fake-framework', name: 'Fake Framework' }],
    capabilities: {},
  },
  rootMarkers: ['fake.manifest'],
  ignoredDirectories: ['fake-cache'],
  ignoredDirectorySuffixes: ['.fake-cache'],
  configFileNames: ['fake.manifest'],
  resolutionInput(path) {
    return path.endsWith('fake.manifest') ? 'content' : undefined;
  },
  signatureInput({ root }) {
    return readFileSync(join(root, 'fake.manifest'), 'utf8');
  },
  readProject({ root }) {
    const name = readFileSync(join(root, 'fake.manifest'), 'utf8');
    return {
      name,
      dependencies: { 'fake-framework': '1' },
      devDependencies: {},
      scripts: {},
      packages: [{ path: 'packages/lib', name, private: true, scripts: {}, dependencies: [] }],
    };
  },
};

it('adds a manifest, package, root marker, ignore rules and cache inputs through a test provider', async () => {
  const actual = await import('./index.js');
  const registry = createEcosystemRegistry([fake]);
  vi.resetModules();
  vi.doMock('./index.js', () => ({ ...actual, ecosystemRegistry: registry }));
  const { discoverProject, findGuardRoot } = await import('../discovery/discovery.js');
  const root = mkdtempSync(join(tmpdir(), 'guard-fake-ecosystem-'));
  roots.push(root);
  mkdirSync(join(root, 'nested'));
  for (const ignored of ['fake-cache', 'nested.fake-cache']) {
    mkdirSync(join(root, ignored));
    writeFileSync(join(root, ignored, 'ignored.ts'), '');
  }
  writeFileSync(join(root, 'fake.manifest'), 'first');
  expect(findGuardRoot(join(root, 'nested'))).toBe(root);
  const project = discoverProject(root, { persistCache: true });
  expect(project.configs).toEqual(['fake.manifest']);
  expect(project.project.name).toBe('first');
  expect(project.project.frameworks).toEqual(['Fake Framework']);
  expect(project.project.workspacePackages).toMatchObject([
    { path: 'packages/lib', name: 'first' },
  ]);
  expect(project.files.map((file) => file.path)).toEqual(['fake.manifest']);
  writeFileSync(join(root, 'fake.manifest'), 'second');
  expect(discoverProject(root).project.name).toBe('second');
});

it('preserves primary metadata precedence while merging provider packages', () => {
  const primary: EcosystemProvider = {
    ...fake,
    readProject() {
      return {
        name: 'primary',
        dependencies: { primary: '1' },
        devDependencies: {},
        scripts: { test: 'original' },
        packages: [],
      };
    },
  };
  const secondary: EcosystemProvider = {
    ...fake,
    readProject() {
      return {
        name: 'secondary',
        dependencies: { secondary: '2' },
        devDependencies: {},
        scripts: {},
        packages: [{ path: 'pkg', private: true, scripts: {}, dependencies: [] }],
      };
    },
  };
  const result = createEcosystemRegistry([primary, secondary]).readProject({
    root: '.',
    allFiles: [],
  });
  expect(result).toMatchObject({
    name: 'primary',
    dependencies: { primary: '1' },
    scripts: { test: 'original' },
    packages: [{ path: 'pkg' }],
  });
});
