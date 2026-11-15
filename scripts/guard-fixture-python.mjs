import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// End-to-end CLI checks for the local Python fixtures. Fixture code is never installed or run.
const cli = resolve(process.env.GUARD_CLI ?? 'dist/cli/index.js');
const fixtures = resolve(process.env.GUARD_LOCAL_FIXTURES ?? 'fixtures');
const names = (
  process.env.GUARD_PYTHON_FIXTURES ??
  'python-app,python-src-layout,python-monorepo,python-mixed,python-edge-cases'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function run(project, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status ?? 1, output: result.stdout, error: result.stderr };
}

function json(project, args) {
  const result = run(project, args);
  try {
    return { ...result, value: JSON.parse(result.output) };
  } catch (error) {
    throw new Error(
      `invalid JSON from ${args.join(' ')} (exit ${result.code}): ${result.error.slice(0, 500)}`,
      { cause: error },
    );
  }
}

function writePolicy(project, rules, contracts) {
  const guardDir = join(project, '.codapult/guard');
  writeFileSync(
    join(guardDir, 'rules.json'),
    `${JSON.stringify({ version: 1, rules }, null, 2)}\n`,
  );
  writeFileSync(
    join(guardDir, 'contracts.json'),
    `${JSON.stringify({ version: 1, contracts }, null, 2)}\n`,
  );
}

const routesNoDb = {
  id: 'routes-no-db',
  description: 'Routes go through services.',
  severity: 'error',
  kind: 'forbidden-import',
  patterns: ['shop.db'],
  files: ['shop/api'],
  status: 'active',
};

const scenarios = {
  'python-app'(project, fail) {
    writePolicy(
      project,
      [routesNoDb],
      [
        {
          id: 'orders-audit',
          statement: 'Order services call audit.',
          kind: 'required-call',
          scope: ['shop/services/orders.py'],
          mustCall: ['audit'],
          status: 'active',
        },
      ],
    );
    const clean = json(project, ['check', '--json']);
    if (!clean.value.report.findings.some((item) => item.ruleId === 'contract:orders-audit'))
      fail('required-call did not detect the missing audit call');
    if (clean.value.report.notApplicable?.some((item) => item.ruleId === 'contract:orders-audit'))
      fail('required-call unexpectedly reported not applicable');

    const injected = join(project, 'shop/api/admin.py');
    writeFileSync(injected, 'from ..db.session import save\n');
    const violated = json(project, ['check', '--json']);
    const finding = violated.value.report.findings.find((item) => item.ruleId === 'routes-no-db');
    if (violated.code === 0 || finding?.file !== 'shop/api/admin.py' || finding.line !== 1)
      fail('the injected forbidden import was not detected at shop/api/admin.py:1');

    const sarif = json(project, ['check', '--sarif']).value;
    const location = sarif.runs[0].results.find((item) => item.ruleId === 'routes-no-db')
      ?.locations?.[0]?.physicalLocation;
    if (location?.artifactLocation.uri !== 'shop/api/admin.py' || location.region.startLine !== 1)
      fail('SARIF does not locate the Python finding');
    if (!sarif.runs[0].results.some((item) => item.ruleId === 'contract:orders-audit'))
      fail('SARIF does not list the required-call finding');

    rmSync(injected);
    const orders = join(project, 'shop/services/orders.py');
    writeFileSync(orders, readFileSync(orders, 'utf8') + '\naudit()\n');
    if (run(project, ['check', '--json']).code !== 0) fail('check did not return to clean');

    const impact = json(project, ['impact', 'shop/db/session.py', '--json']).value;
    if (!impact.dependents.includes('shop/api/routes.py'))
      fail('impact does not reach shop/api/routes.py');
    if (impact.graph?.status !== 'complete') fail('impact graph status is not complete');

    const doctor = json(project, ['doctor', '--json']).value;
    if (doctor.importResolution?.[0]?.language !== 'python')
      fail('doctor does not report the Python import summary');
  },
  'python-src-layout'(project, fail, model) {
    if (!model.insights.dependencyEdges.some((edge) => edge.from === 'tests/test_core.py'))
      fail('tests do not resolve through src/');
  },
  'python-monorepo'(project, fail, model) {
    if (model.insights.dependencyEdges.length !== 2)
      fail('cross-package namespace imports were not resolved');
  },
  'python-mixed'(project, fail, model) {
    const languages = (model.insights.importResolution ?? []).map((item) => item.language);
    if (languages.join(',') !== 'js-ts,python') fail('both languages are not summarized');
    const crossing = model.insights.dependencyEdges.filter(
      (edge) => edge.from.endsWith('.py') !== edge.to.endsWith('.py'),
    );
    if (crossing.length > 0) fail('an edge crosses languages');
  },
  'python-edge-cases'(project, fail, model) {
    if (model.files.some((file) => file.path.startsWith('.venv/'))) fail('.venv was not ignored');
    const impact = json(project, ['impact', 'pkg/core.py', '--json']).value;
    if (impact.graph?.status !== 'partial' || impact.graph.unresolvedImportCount !== 3)
      fail('impact does not report the unresolved imports as a partial graph');
  },
};

const failures = [];
for (const name of names) {
  const source = join(fixtures, name);
  if (!existsSync(source)) {
    failures.push(`${name}: fixture is missing`);
    continue;
  }
  const project = mkdtempSync(join(tmpdir(), `guard-python-${name}-`));
  const fail = (message) => failures.push(`${name}: ${message}`);
  try {
    cpSync(source, project, { recursive: true });
    const init = run(project, ['init']);
    if (init.code !== 0) {
      fail(`init exited ${init.code}: ${init.error.slice(0, 500)}`);
      continue;
    }
    const model = JSON.parse(readFileSync(join(project, '.codapult/guard/project.json'), 'utf8'));
    if (!model.modules.some((module) => module.path.endsWith('.py')))
      fail('no Python modules were discovered');
    scenarios[name]?.(project, fail, model);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (!process.env.GUARD_KEEP_PYTHON_PROJECTS) rmSync(project, { recursive: true, force: true });
    else console.error(`kept Python fixture project: ${project}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Guard Python fixtures passed: ${names.join(', ')}`);
