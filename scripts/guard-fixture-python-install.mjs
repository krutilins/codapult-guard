import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Package and install the actual build, without publishing or relying on a
// consumer package.json. Installation runs away from hostile checkout config.
const source = resolve('.');
const root = mkdtempSync(join(tmpdir(), 'guard-python-install-'));
const runtime = join(root, 'runtime');
const env = {
  ...process.env,
  NPM_CONFIG_CACHE: process.env.GUARD_NPM_CACHE ?? join(tmpdir(), 'guard-install-npm-cache'),
  NPM_CONFIG_USERCONFIG: '/dev/null',
  NPM_CONFIG_GLOBALCONFIG: join(root, 'global.npmrc'),
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
let client;
try {
  const project = join(root, 'consumer');
  mkdirSync(project);
  writeFileSync(join(project, 'pyproject.toml'), '[project]\nname = "python-only-adoption"\n');
  writeFileSync(
    join(project, 'main.py'),
    'raise RuntimeError("Guard must not execute application source")\n',
  );
  writeFileSync(join(project, '.npmrc'), 'registry=https://invalid.example\n');
  writeFileSync(join(project, 'check.cjs'), 'console.log("explicit check passed")\n');
  const packed = JSON.parse(
    execFileSync(npm, ['pack', '--json', '--pack-destination', root], {
      cwd: source,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    }),
  );
  const tarball = join(root, packed[0].filename);
  execFileSync(
    npm,
    [
      'install',
      '--prefix',
      runtime,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarball,
    ],
    { cwd: root, env, stdio: 'pipe', timeout: 180_000 },
  );
  const cli = join(runtime, 'node_modules/@codapult/guard/dist/cli/index.js');
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: project,
      encoding: 'utf8',
      timeout: 120_000,
    });
  run(['init']);
  const agentPath = join(project, '.codapult/guard/agent.json');
  const agent = JSON.parse(readFileSync(agentPath, 'utf8'));
  agent.checks = { test: 'node check.cjs' };
  agent.completionGate.checks = ['test'];
  agent.tools = 'off';
  writeFileSync(agentPath, JSON.stringify(agent));
  const verification = JSON.parse(run(['verify', '--json']));
  assert.equal(verification.checks.test.status, 'passed');
  assert.equal(verification.outcome, 'pass');
  assert.equal(verification.runtime.packageManager, undefined);
  assert.equal(existsSync(join(project, 'package.json')), false);
  client = new Client({ name: 'python-install-smoke', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp-server'],
      cwd: project,
      stderr: 'pipe',
    }),
  );
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === 'codapult_guard_verify'));
  console.log(
    JSON.stringify({
      suite: 'python-install',
      status: 'passed',
      version: packed[0].version,
      init: 'passed',
      verify: verification.outcome,
      mcp: 'initialized',
      packageJson: false,
    }),
  );
} finally {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
}
