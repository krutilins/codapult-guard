import { npmSignals } from './signals.js';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { readJsonObject, asStringRecord } from '../../files.js';
import type { ProjectModel } from '../../discovery/discovery.js';
import type { EcosystemProvider, ProjectCheckMetadata } from '../types.js';
const configNames = new Set([
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

export const npmEcosystem = {
  id: 'npm',
  signals: npmSignals,
  protectedPaths: [
    { pattern: 'package.json', kind: 'dependency-input' },
    { pattern: '**/package.json', kind: 'dependency-input' },
    { pattern: 'pnpm-lock.yaml', kind: 'dependency-input' },
    { pattern: '**/pnpm-lock.yaml', kind: 'dependency-input' },
    { pattern: 'yarn.lock', kind: 'tool-config' },
    { pattern: '**/yarn.lock', kind: 'tool-config' },
    { pattern: 'package-lock.json', kind: 'dependency-input' },
    { pattern: '**/package-lock.json', kind: 'dependency-input' },
    { pattern: 'npm-shrinkwrap.json', kind: 'tool-config' },
    { pattern: '**/npm-shrinkwrap.json', kind: 'tool-config' },
    { pattern: 'bun.lock', kind: 'tool-config' },
    { pattern: '**/bun.lock', kind: 'tool-config' },
    { pattern: 'bun.lockb', kind: 'tool-config' },
    { pattern: '**/bun.lockb', kind: 'tool-config' },
    { pattern: 'pnpm-workspace.yaml', kind: 'tool-config' },
    { pattern: '**/pnpm-workspace.yaml', kind: 'tool-config' },
    { pattern: '.npmrc', kind: 'dependency-input' },
    { pattern: '**/.npmrc', kind: 'dependency-input' },
    { pattern: '.pnpmfile.cjs', kind: 'tool-config' },
    { pattern: '**/.pnpmfile.cjs', kind: 'tool-config' },
    { pattern: 'pnpmfile.cjs', kind: 'tool-config' },
    { pattern: '**/pnpmfile.cjs', kind: 'tool-config' },
    { pattern: '.yarnrc', kind: 'tool-config' },
    { pattern: '**/.yarnrc', kind: 'tool-config' },
    { pattern: '.yarnrc.yml', kind: 'tool-config' },
    { pattern: '**/.yarnrc.yml', kind: 'tool-config' },
    { pattern: '.pnp.cjs', kind: 'tool-config' },
    { pattern: '**/.pnp.cjs', kind: 'tool-config' },
    { pattern: '.pnp.loader.mjs', kind: 'tool-config' },
    { pattern: '**/.pnp.loader.mjs', kind: 'tool-config' },
    { pattern: '.npmignore', kind: 'ignore-config' },
    { pattern: '.prettierignore', kind: 'ignore-config' },
    { pattern: '.eslintignore', kind: 'ignore-config' },
    { pattern: 'eslint.config.*', kind: 'tool-config' },
    { pattern: '.eslintrc*', kind: 'tool-config' },
    { pattern: 'biome.json', kind: 'tool-config' },
    { pattern: 'biome.jsonc', kind: 'tool-config' },
    { pattern: '.biomeignore', kind: 'ignore-config' },
    { pattern: 'prettier.config.*', kind: 'tool-config' },
    { pattern: '.prettierrc*', kind: 'tool-config' },
    { pattern: 'tsconfig.json', kind: 'tool-config' },
    { pattern: 'vitest.config.*', kind: 'tool-config' },
    { pattern: 'jest.config.*', kind: 'tool-config' },
    { pattern: 'playwright.config.*', kind: 'tool-config' },
    { pattern: 'next.config.*', kind: 'tool-config' },
    { pattern: 'babel.config.*', kind: 'tool-config' },
    { pattern: '.babelrc*', kind: 'tool-config' },
    { pattern: 'webpack.config.*', kind: 'tool-config' },
    { pattern: 'stylelint.config.*', kind: 'tool-config' },
    { pattern: '.stylelintrc*', kind: 'tool-config' },
    { pattern: 'nyc.config.*', kind: 'tool-config' },
    { pattern: 'tsconfig*.json', kind: 'tool-config' },
  ],
  rootMarkers: ['package.json', 'tsconfig.json', 'jsconfig.json'],
  ignoredDirectories: [
    '.next',
    '.turbo',
    'node_modules',
    '.vercel',
    'out',
    'playwright-report',
    'test-results',
  ],
  configFileNames: [...configNames],
  resolutionInput(path) {
    return /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(
      basename(path),
    )
      ? 'content'
      : undefined;
  },
  signatureInput({ root }) {
    return JSON.stringify(readJsonObject(resolve(root, 'package.json')));
  },
  readCheckMetadata(root): ProjectCheckMetadata {
    return readJsonObject(resolve(root, 'package.json'));
  },
  readProject({ root, allFiles }) {
    const manifest = readJsonObject(resolve(root, 'package.json'));
    const manager = packageManager(root);
    const packages = workspacePackages(root, allFiles);
    if (
      !existsSync(resolve(root, 'package.json')) &&
      manager === undefined &&
      packages.length === 0
    )
      return undefined;
    return {
      ...(typeof manifest.name === 'string' ? { name: manifest.name } : {}),
      ...(manager ? { packageManager: manager } : {}),
      dependencies: asStringRecord(manifest.dependencies),
      devDependencies: asStringRecord(manifest.devDependencies),
      scripts: asStringRecord(manifest.scripts),
      packages,
    };
  },
} satisfies EcosystemProvider;
