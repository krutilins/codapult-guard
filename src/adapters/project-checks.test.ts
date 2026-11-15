import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectProjectRuntime,
  runProjectChecks,
  runProjectAdapters,
  runWorkspaceProjectChecks,
} from './project-checks.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runProjectChecks', () => {
  it('does not invent a package manager for Python-only or empty repositories', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-runtime-'));
    roots.push(root);
    expect(inspectProjectRuntime(root).packageManager).toBeUndefined();
    writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "checks"\n');
    expect(inspectProjectRuntime(root)).toEqual({
      node: process.versions.node,
      compatible: true,
      issues: [],
    });
    expect(runProjectChecks(root, ['test']).test?.status).toBe('not-configured');
  });

  it('runs explicit commands once at the root and overrides npm in mixed projects', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-mixed-check-'));
    roots.push(root);
    writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "checks"\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'exit 1' } }));
    writeFileSync(join(root, 'check.cjs'), 'console.log("explicit-root")');
    const options = { commands: { test: 'node check.cjs' } };
    const rootResults = runProjectChecks(root, ['test'], options);
    expect(rootResults.test).toMatchObject({
      status: 'passed',
      command: 'node check.cjs',
      stdout: 'explicit-root\n',
    });
    expect(
      runWorkspaceProjectChecks(root, [{ path: 'nested', scripts: { test: 'exit 1' } }], ['test'], {
        ...options,
        rootResults,
      }),
    ).toEqual({});
  });

  it('normalizes explicit tool failures and timeouts without shell execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-explicit-errors-'));
    roots.push(root);
    writeFileSync(join(root, 'fail.cjs'), 'process.stderr.write("tool failed");process.exit(7)');
    writeFileSync(join(root, 'wait.cjs'), 'setTimeout(() => {}, 10000)');
    const results = runProjectChecks(root, ['lint', 'typecheck', 'test', 'build'], {
      commands: {
        lint: 'guard-missing-tool-123',
        typecheck: 'node fail.cjs',
        test: 'node wait.cjs',
        build: 'echo forbidden && echo shell',
      },
      timeout: 150,
    });
    expect(results.lint).toMatchObject({ status: 'failed', stderr: 'Command failed: ENOENT' });
    expect(results.typecheck).toMatchObject({
      status: 'failed',
      exitCode: 7,
      stderr: 'tool failed',
    });
    expect(results.test).toMatchObject({ status: 'failed', timedOut: true });
    expect(results.build).toMatchObject({ status: 'failed', exitCode: 2 });
  });

  it('marks missing scripts as not-configured instead of failed', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-checks-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }));

    const result = runProjectChecks(root, ['lint', 'test', 'build', 'typecheck']);

    expect(result).toMatchObject({
      lint: { status: 'not-configured', passed: false },
      test: { status: 'not-configured', passed: false },
      build: { status: 'not-configured', passed: false },
      typecheck: { status: 'not-configured', passed: false },
    });
  });

  it('uses the declared typecheck script when available', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-check-script-'));
    roots.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        packageManager: 'npm@11',
        scripts: { typecheck: 'node -e "process.exit(0)"' },
      }),
    );

    const result = runProjectChecks(root, ['typecheck']);

    expect(result.typecheck).toMatchObject({ status: 'passed', passed: true });
  });

  it('runs test scripts exactly as declared by the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-test-script-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'npm@11', scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    const result = runProjectChecks(root, ['test']);

    expect(result.test).toMatchObject({
      status: 'passed',
      command: 'npm run test',
    });
  });

  it('reports an incompatible Node engine without running project commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-runtime-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ engines: { node: '>=999' }, packageManager: 'npm@11', scripts: {} }),
    );

    expect(inspectProjectRuntime(root)).toMatchObject({
      compatible: false,
      declaredNode: '>=999',
      declaredPackageManager: 'npm@11',
    });
  });

  it('accepts a matching Node engine and lockfile package manager', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-runtime-compatible-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

    expect(inspectProjectRuntime(root)).toMatchObject({
      compatible: true,
      packageManager: 'pnpm',
    });
  });

  it('evaluates Node engine minor and patch constraints instead of major only', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-runtime-range-'));
    roots.push(root);
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ engines: { node: `>=${major}.${minor}.${patch}` } }),
    );
    expect(inspectProjectRuntime(root)).toMatchObject({ compatible: true });

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ engines: { node: `>${major}.${minor}.${patch}` } }),
    );
    expect(inspectProjectRuntime(root)).toMatchObject({ compatible: false });
  });

  it('runs a workspace check when the root does not own it', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-workspace-checks-'));
    roots.push(root);
    mkdirSync(join(root, 'packages', 'web'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    writeFileSync(
      join(root, 'packages', 'web', 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    const rootResults = runProjectChecks(root, ['test']);
    const workspaceResults = runWorkspaceProjectChecks(
      root,
      [{ path: 'packages/web', scripts: { test: 'node -e "process.exit(0)"' } }],
      ['test'],
      { rootResults },
    );

    expect(workspaceResults['packages/web'].test).toMatchObject({
      status: 'passed',
      command: 'pnpm run test',
    });
  });

  it('does not execute the same configured script twice for overlapping adapters', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-adapter-dedup-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { audit: 'node -e "process.exit(0)"' } }),
    );

    const result = runProjectAdapters(root, {
      mode: 'auto',
      tooling: {
        security: { script: 'audit', enabled: true },
        'dependency-audit': { script: 'audit', enabled: true },
      },
    });

    expect(result.security).toBe(result['dependency-audit']);
  });
});
