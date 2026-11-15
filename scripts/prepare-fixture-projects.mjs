import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { fixtureProjects as projects } from './fixture-projects.mjs';

const root = resolve(process.env.GUARD_FIXTURES_ROOT ?? '../guard-fixtures');

if (!existsSync(root)) {
  mkdirSync(root);
}

for (const { name, url, sha } of projects) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Invalid fixture commit SHA for ${name}: ${sha}`);
  }

  const project = join(root, name);

  if (!existsSync(join(project, '.git'))) {
    const result = spawnSync('git', ['clone', '--depth', '1', url, project], {
      stdio: 'pipe',
      timeout: 120_000,
    });
    if (result.status !== 0) {
      rmSync(project, { recursive: true, force: true });
      const stderr = result.stderr.toString().trim() || 'unknown error';
      throw new Error(`git clone failed: ${stderr}`);
    }
  }

  for (const args of [
    ['fetch', '--depth=1', 'origin', sha],
    ['checkout', '--detach', sha],
  ]) {
    const result = spawnSync('git', args, { cwd: project, stdio: 'pipe', timeout: 120_000 });
    if (result.status !== 0) {
      const stderr = result.stderr.toString().trim() || result.error?.message || 'unknown error';
      throw new Error(`git ${args[0]} failed for ${name}: ${stderr}`);
    }
  }
}
