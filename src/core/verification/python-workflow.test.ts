import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

interface Step {
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  'working-directory'?: string;
}
const python = parse(
  readFileSync(new URL('../../../docs/guard-ci-python.yml', import.meta.url), 'utf8'),
) as { jobs: { guard: { steps: Step[] } }; on: unknown };
const npm = parse(
  readFileSync(new URL('../../../docs/guard-ci.yml', import.meta.url), 'utf8'),
) as typeof python;
const steps = python.jobs.guard.steps;
const step = (name: string): Step => steps.find((item) => item.name === name)!;

describe('Python consumer workflow', () => {
  it('preserves shared base-policy, receipt, merge-group and SARIF hardening', () => {
    expect(python.on).toEqual(npm.on);
    for (const original of npm.jobs.guard.steps) {
      if (
        [
          'Install pnpm',
          'Setup Node.js',
          'Install dependencies',
          'Verify Guard runtime dependencies against base',
        ].includes(original.name)
      )
        continue;
      const candidate = step(original.name);
      // Only the executable differs; the event handling and output guards are shared.
      const normalized = JSON.stringify(candidate).replaceAll(
        'node \\"$RUNNER_TEMP/codapult-guard-runtime/node_modules/@codapult/guard/dist/cli/index.js\\"',
        'pnpm exec codapult-guard',
      );
      expect(JSON.parse(normalized), original.name).toEqual(original);
    }
    for (const item of steps.filter((candidate) => candidate.uses))
      expect(item.uses).toMatch(/@[a-f0-9]{40}$/);
  });

  it('installs an exact version away from checkout configuration and disables lifecycle scripts', () => {
    const install = step('Install pinned Guard outside the checkout');
    expect(install['working-directory']).toBe('${{ runner.temp }}');
    expect(install.env).toMatchObject({
      NPM_CONFIG_USERCONFIG: '/dev/null',
      NPM_CONFIG_GLOBALCONFIG: '${{ runner.temp }}/codapult-guard-global.npmrc',
    });
    expect(install.env?.GUARD_VERSION).toBe('${{ vars.CODAPULT_GUARD_VERSION }}');
    expect(install.run).toContain('^' + '[0-9]+\\.[0-9]+\\.[0-9]+');
    expect(install.run).toContain('Set CODAPULT_GUARD_VERSION to an exact Guard release version.');
    expect(install.run).toContain('"@codapult/guard@$GUARD_VERSION"');
    expect(install.run).toContain('--ignore-scripts');
    expect(install.run).toContain('--prefix "$RUNNER_TEMP/codapult-guard-runtime"');
    expect(steps.some((item) => item.run?.includes('pnpm'))).toBe(false);
  });

  it.each(['1.2.3', '1.2.3-rc.1', '', 'latest', '^1.2.3', '1.2.3;echo injected'])(
    'enforces exact release version %s before invoking npm',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'guard-python-install-step-'));
      try {
        const capture = join(root, 'args');
        writeFileSync(join(root, 'npm'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$GUARD_CAPTURE"\n');
        chmodSync(join(root, 'npm'), 0o755);
        const execute = (): Buffer =>
          execFileSync(
            '/bin/bash',
            ['-e', '-c', step('Install pinned Guard outside the checkout').run!],
            {
              cwd: root,
              stdio: 'pipe',
              env: {
                ...process.env,
                PATH: `${root}${delimiter}${process.env.PATH}`,
                RUNNER_TEMP: root,
                GUARD_VERSION: version,
                GUARD_CAPTURE: capture,
                NPM_CONFIG_USERCONFIG: '/dev/null',
                NPM_CONFIG_GLOBALCONFIG: join(root, 'global.npmrc'),
              },
            },
          );
        if (version === '1.2.3' || version === '1.2.3-rc.1') {
          execute();
          const args = readFileSync(capture, 'utf8');
          expect(args).toContain(`@codapult/guard@${version}`);
          expect(args).toContain('--ignore-scripts');
        } else {
          expect(execute).toThrow();
          expect(existsSync(capture)).toBe(false);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each(['pull_request', 'merge_group'])(
    'skips project code for %s and applies exact base policy',
    (event) => {
      const root = mkdtempSync(join(tmpdir(), 'guard-python-workflow-'));
      try {
        writeFileSync(
          join(root, 'node'),
          '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$GUARD_CAPTURE"\nprintf \'{"outcome":"pass"}\\n\'\n',
        );
        chmodSync(join(root, 'node'), 0o755);
        // These files must not participate in Guard selection or command resolution.
        writeFileSync(join(root, '.npmrc'), 'registry=https://invalid.example\n');
        writeFileSync(join(root, 'package.json'), '{"scripts":{"test":"exit 99"}}');
        execFileSync('/bin/bash', ['-e', '-c', step('Verify Guard and project checks').run!], {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${root}${delimiter}${process.env.PATH}`,
            RUNNER_TEMP: root,
            GITHUB_EVENT_NAME: event,
            POLICY_BASE: 'base-sha',
            GUARD_POLICY_MODE: 'strict',
            GUARD_CAPTURE: join(root, 'args'),
            GUARD_RESULT_FILE: join(root, 'result.json'),
            GUARD_STATEMENT_FILE: join(root, 'statement.json'),
          },
        });
        const args = readFileSync(join(root, 'args'), 'utf8');
        expect(args).toContain(
          `${root}/codapult-guard-runtime/node_modules/@codapult/guard/dist/cli/index.js\nverify`,
        );
        expect(args).toContain('--no-project-checks\n--tools\noff');
        expect(args).toContain('--policy-base\nbase-sha');
        expect(args).toContain('--fail-on-protected-changes');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
