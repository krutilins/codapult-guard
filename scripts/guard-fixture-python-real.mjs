import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { discoverProject, buildGeneratedGuardConfig } from '../dist/index.js';
import { fixtureProjects } from './fixture-projects.mjs';

const root = resolve(process.env.GUARD_FIXTURES_ROOT ?? '../guard-fixtures');
const results = [];
for (const project of fixtureProjects.filter((item) => item.framework)) {
  const checkout = join(root, project.name);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8',
  }).trim();
  assert.equal(revision, project.sha, `${project.name}: unexpected revision`);
  const model = discoverProject(join(checkout, project.subdirectory ?? ''), {
    persistCache: false,
  });
  const repeated = discoverProject(join(checkout, project.subdirectory ?? ''), {
    persistCache: false,
  });
  assert.deepEqual(repeated, model, `${project.name}: nondeterministic discovery`);
  assert(model.modules.length > 0);
  assert(
    model.project.frameworks.includes(project.framework),
    `${project.name}: missing framework`,
  );
  assert(
    model.patterns.routeHandlers.includes(project.entrypoint),
    `${project.name}: missing entrypoint`,
  );
  assert(
    model.insights.dependencyEdges.some((edge) => edge.from === project.resolvedFrom),
    `${project.name}: missing representative local resolution`,
  );
  for (const edge of model.insights.dependencyEdges) {
    assert(
      model.modules.some((module) => module.path === edge.to),
      `${project.name}: missing graph target`,
    );
  }
  results.push({
    project: project.name,
    revision,
    status: 'passed',
    modules: model.modules.length,
    imports: model.insights.importResolution,
    frameworks: model.project.frameworks,
    entrypoints: model.patterns.routeDetails,
    proposals: buildGeneratedGuardConfig(model).contracts ?? [],
    diagnostics: model.diagnostics ?? [],
  });
}
if (process.env.GUARD_PYTHON_REAL_RESULTS)
  writeFileSync(process.env.GUARD_PYTHON_REAL_RESULTS, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
