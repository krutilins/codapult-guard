import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// Maintainer-only harness. It is intentionally outside Guard and its CI smoke job.
const root = resolve(process.env.GUARD_FIXTURES_ROOT ?? '../guard-fixtures');
const selected = process.env.GUARD_NATIVE_PROJECTS?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const matrix = {
  'next-learn': {
    install: ['pnpm', ['install', '--frozen-lockfile']],
    command: ['pnpm', ['run', 'test']],
  },
  'vite-react-ts-starter': {
    install: ['npm', ['ci', '--ignore-scripts']],
    command: ['npm', ['run', 'test', '--', '--run']],
  },
  changesets: {
    install: ['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
    command: ['pnpm', ['run', 'check-all']],
    env: { COREPACK_ENABLE_PROJECT_SPEC: '0' },
  },
  'node-server': {
    install: ['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
    command: ['pnpm', ['run', 'test', '--', '--run']],
  },
  express: {
    install: ['npm', ['install', '--no-package-lock', '--ignore-scripts']],
    command: ['npm', ['test']],
  },
};
const containerProjects = new Set(
  process.env.GUARD_NATIVE_CONTAINER_PROJECTS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [],
);
const projects = selected?.length ? selected : Object.keys(matrix);
const results = [];

function run(project, [program, args], env = {}) {
  execFileSync(program, args, {
    cwd: project,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: 900_000,
  });
}

// Optional isolated fixture runtime: no host ports are published and
// only a source archive is mounted read-only. Existing services remain untouched.
function runContainer(project, name, config) {
  if (process.env.GUARD_NATIVE_INSTALL !== '1')
    throw new Error('Container fixtures require GUARD_NATIVE_INSTALL=1.');
  const temporary = mkdtempSync(join(tmpdir(), 'guard-native-container-'));
  const archive = join(temporary, 'source.tar');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = ([program, args]) => [program, ...args].map(quote).join(' ');
  const image = name === 'express' ? 'node:22.12.0' : 'node:24.14.0';
  try {
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], {
      cwd: project,
    });
    const setup =
      config.install[0] === 'pnpm'
        ? 'npm install --global corepack@0.34.1 --ignore-scripts --no-audit --no-fund; corepack enable; '
        : '';
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--env',
        'COREPACK_HOME=/tmp/corepack-cache',
        '--mount',
        `type=bind,source=${archive},target=/fixture.tar,readonly`,
        image,
        'sh',
        '-ec',
        'mkdir /project; tar -xf /fixture.tar -C /project; cd /project; ' +
          setup +
          command(config.install) +
          '; chown -R node:node /project; if [ -d /tmp/corepack-cache ]; then chown -R node:node /tmp/corepack-cache; fi; su node -s /bin/sh -c ' +
          quote(command(config.command)),
      ],
      { stdio: 'inherit', timeout: 900_000 },
    );
    return image;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

for (const name of projects) {
  const project = join(root, name);
  const config = matrix[name];
  if (!config || !existsSync(join(project, 'package.json'))) {
    results.push({ project: name, status: 'missing' });
    continue;
  }
  const result = {
    project: name,
    status: 'passed',
    install: config.install.join(' '),
    command: config.command.join(' '),
  };
  try {
    if (containerProjects.has(name)) {
      result.runtime = runContainer(project, name, config);
    } else {
      if (process.env.GUARD_NATIVE_INSTALL === '1') run(project, config.install, config.env);
      run(project, config.command, config.env);
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
  }
  results.push(result);
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.status !== 'passed')) process.exitCode = 1;
