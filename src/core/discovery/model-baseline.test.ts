import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverProject } from './discovery.js';
import {
  buildGuardProposals,
  getGuardProposalFreshness,
  scanGuard,
  type GuardConfig,
} from '../guard.js';

const fixtures = resolve(import.meta.dirname, '../../../fixtures');
const roots: string[] = [];
const policy: GuardConfig = {
  version: 1,
  rules: ['forbidden-import', 'client-forbidden-import'].map((kind) => ({
    id: kind,
    kind: kind as 'forbidden-import' | 'client-forbidden-import',
    description: kind,
    severity: 'error',
    patterns: ['*'],
  })),
  contracts: [
    { id: 'guidance', kind: 'guidance', statement: 'guidance' },
    {
      id: 'imports',
      kind: 'import-boundary',
      statement: 'imports',
      mustNotImport: ['*'],
      mustImport: ['baseline-required'],
    },
    { id: 'calls', kind: 'required-call', statement: 'calls', mustCall: ['baselineRequired'] },
    {
      id: 'packages',
      kind: 'package-boundary',
      statement: 'packages',
      fromPackages: ['*'],
      mustNotImportPackages: ['*'],
    },
  ],
  budgets: (['lines', 'bytes', 'imports'] as const).map((metric) => ({
    id: metric,
    metric,
    description: metric,
    reason: 'baseline',
    severity: 'warning',
    scope: ['*'],
    limit: 1,
  })),
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function copy(name: string, reverse = false): string {
  const root = mkdtempSync(join(tmpdir(), 'guard-baseline-'));
  roots.push(root);
  const source = join(fixtures, name);
  if (!reverse) cpSync(source, root, { recursive: true });
  else {
    const paths = readdirSync(source, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .reverse();
    for (const path of paths) {
      const target = join(root, path.slice(source.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(path));
    }
  }
  return root;
}

function baseline(root: string): unknown {
  const model = { ...discoverProject(root, { persistCache: false }) };
  Reflect.deleteProperty(model, 'git');
  const { findings, notApplicable } = scanGuard(root, policy, {
    now: '2026-10-18T00:00:00Z',
    waivers: [],
  });
  return { model, findings, notApplicable };
}

describe('fixture model and policy baseline', () => {
  for (const fixture of readdirSync(fixtures, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    it(fixture, () => {
      const root = copy(fixture);
      const value = baseline(root);
      // Snapshot updates require an explanation of intended differences in the commit message.
      expect(value).toMatchSnapshot();
      expect(baseline(root)).toEqual(value);
      expect(baseline(copy(fixture, true))).toEqual(value);
    });
  }

  it('detects import edits and makes stored proposals stale', () => {
    const root = copy('python-app');
    const model = discoverProject(root);
    const proposals = buildGuardProposals(model, policy);
    expect(getGuardProposalFreshness(model, proposals)).toBe('current');
    const before = baseline(root);
    const path = join(root, 'shop/api/routes.py');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nimport baseline_added\n`);
    expect(baseline(root)).not.toEqual(before);
    expect(getGuardProposalFreshness(discoverProject(root), proposals)).toBe('stale');
  });
});
