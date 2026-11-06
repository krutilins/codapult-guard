import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const commands = vi.hoisted(() => [] as string[]);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const recorded = <T extends (...args: never[]) => unknown>(run: T): T =>
    ((...args: Parameters<T>) => {
      commands.push(String(args[0]));
      return run(...args);
    }) as T;
  return {
    ...actual,
    exec: recorded(actual.exec),
    execFile: recorded(actual.execFile),
    execFileSync: recorded(actual.execFileSync),
    execSync: recorded(actual.execSync),
    fork: recorded(actual.fork),
    spawn: recorded(actual.spawn),
    spawnSync: recorded(actual.spawnSync),
  };
});

const { discoverProject } = await import('./discovery/discovery.js');
const { initializeGuard, scanGuard } = await import('./guard.js');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Python analysis without execution', () => {
  it('never runs project code or a process other than git', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-python-no-exec-'));
    roots.push(root);
    const marker = join(root, 'executed.txt');
    // Each file writes the marker when Python imports or runs it.
    const payload = `open(${JSON.stringify(marker)}, "w").write("executed")\n`;
    const files: Record<string, string> = {
      'pyproject.toml': '[project]\nname = "trap"\n',
      'setup.py': `${payload}from setuptools import setup\nsetup()\n`,
      'noxfile.py': `import nox\n${payload}`,
      'conftest.py': `import pytest\n${payload}`,
      'trap/__init__.py': `${payload}from . import core\n`,
      'trap/core.py': `import importlib\n${payload}importlib.import_module("trap.other")\n`,
      'tests/test_trap.py': `from trap import core\n${payload}`,
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), content);
    }

    const model = discoverProject(root, { persistCache: false });
    initializeGuard(root);
    scanGuard(root, {
      version: 1,
      rules: [
        {
          id: 'no-importlib',
          description: 'Use static imports.',
          severity: 'warning',
          kind: 'forbidden-import',
          patterns: ['importlib'],
        },
      ],
    });

    expect(model.modules.map((module) => module.path)).toContain('setup.py');
    expect(existsSync(marker)).toBe(false);
    expect(commands.length).toBeGreaterThan(0);
    expect([...new Set(commands)]).toEqual(['git']);
  });
});
