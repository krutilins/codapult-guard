import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readJsonObject } from '../../files.js';
import type { ProjectCheck } from '../../model/types.js';
import type { ProjectCheckMetadata, ProjectRuntimeDiagnostics } from '../types.js';
const require = createRequire(import.meta.url);
const { satisfies } = require('semver') as {
  satisfies: (version: string, range: string) => boolean;
};
function hasNpmProject(root: string): boolean {
  return [
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'bun.lock',
    'bun.lockb',
  ].some((path) => existsSync(resolve(root, path)));
}
function packageManager(root: string, declared?: string): string {
  const name = declared?.split('@', 1)[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'npm' || name === 'bun') return name;
  for (const [lockfile, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ] as const) {
    if (existsSync(resolve(root, lockfile))) return manager;
  }
  return 'pnpm';
}

export function runtimeDiagnostics(root: string): ProjectRuntimeDiagnostics | undefined {
  if (!hasNpmProject(root)) return undefined;
  const metadata = readJsonObject(resolve(root, 'package.json')) as ProjectCheckMetadata;
  const manager = packageManager(root, metadata.packageManager);
  const issues: string[] = [];
  const declaredNode = metadata.engines?.node;
  let nodeCompatible = true;
  if (declaredNode) {
    try {
      nodeCompatible = satisfies(process.versions.node, declaredNode);
    } catch {
      nodeCompatible = false;
    }
  }
  if (declaredNode && !nodeCompatible) {
    issues.push(`Node ${process.versions.node} does not satisfy engines.node "${declaredNode}".`);
  }
  const declaredManager = metadata.packageManager?.split('@', 1)[0];
  if (declaredManager && declaredManager !== manager) {
    issues.push(
      `Detected package manager ${manager}, but packageManager declares ${declaredManager}.`,
    );
  }
  return {
    node: process.versions.node,
    packageManager: manager,
    ...(metadata.packageManager ? { declaredPackageManager: metadata.packageManager } : {}),
    ...(declaredNode ? { declaredNode } : {}),
    compatible: issues.length === 0,
    issues,
  };
}

function commandFor(
  root: string,
  manager: string,
  check: ProjectCheck,
  scripts: Record<string, string>,
): string | undefined {
  const run = (script: string, suffix = ''): string =>
    manager === 'npm' ? `npm run ${script}${suffix}` : `${manager} run ${script}${suffix}`;
  if (check === 'typecheck' && !scripts.typecheck && !scripts['type-check']) {
    if (!existsSync(resolve(root, 'tsconfig.json'))) return undefined;
    return manager === 'npm' ? 'npx --no-install tsc --noEmit' : `${manager} exec tsc --noEmit`;
  }
  if (check === 'typecheck') return run(scripts.typecheck ? 'typecheck' : 'type-check');
  if (!scripts[check]) return undefined;
  return run(check);
}

export function projectCheckCommand(check: ProjectCheck, root: string): string | undefined {
  if (!hasNpmProject(root)) return undefined;
  const metadata = readJsonObject(resolve(root, 'package.json')) as ProjectCheckMetadata;
  return commandFor(
    root,
    packageManager(root, metadata.packageManager),
    check,
    metadata.scripts ?? {},
  );
}
