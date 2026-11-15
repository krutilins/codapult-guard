import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import type { EcosystemContext, EcosystemProject, WorkspacePackage } from '../types.js';

export const normalizeName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const development = (name: string): boolean =>
  /(?:^|[-_.])(dev|development|test|tests|testing|lint|docs|doc)(?:$|[-_.])/i.test(name);
export function readPythonProject({
  root,
  allFiles,
}: EcosystemContext): EcosystemProject | undefined {
  const manifests = allFiles.filter((p) =>
    /^(pyproject\.toml|setup\.cfg|setup\.py)$/.test(basename(p)),
  );
  const requirements = allFiles.filter((p) => /^requirements.*\.txt$/.test(basename(p)));
  if (manifests.length === 0 && requirements.length === 0) return undefined;
  const diagnostics: { path: string; message: string }[] = [];
  const warn = (path: string, message: string): void => {
    diagnostics.push({ path, message });
  };
  const dirs = [...new Set(manifests.map(dirname))].sort();
  const packages: WorkspacePackage[] = [];
  const requirementOwner = (file: string): string =>
    dirs
      .filter((dir) => dir === '.' || file.startsWith(dir + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? dirname(file);
  const roots = [...new Set([...dirs, ...requirements.map(requirementOwner)])].sort();
  const summaries = new Map<
    string,
    {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      name?: string;
      manager?: string;
    }
  >();
  for (const dir of roots) {
    let name: string | undefined;
    const declarations: NonNullable<WorkspacePackage['dependencyDeclarations']> = [];
    const entrypoints: NonNullable<WorkspacePackage['entrypoints']> = [];
    const add = (raw: string, group: string, source: string): void => {
      const text = raw.trim().replace(/\s+#.*$/, '');
      const namedURL = /[#&]egg=([A-Za-z0-9_.-]+)/.exec(text);
      const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[^\]]*\])?(?=\s*(?:[<>=!~;@(]|$))/.exec(
        text,
      );
      const writtenName = namedURL?.[1] ?? match?.[1];
      if (!writtenName) return;
      declarations.push({
        name: normalizeName(writtenName),
        writtenName,
        requirement: text,
        group,
        source,
      });
    };
    const pyproject = dir === '.' ? 'pyproject.toml' : `${dir}/pyproject.toml`;
    const cfg = dir === '.' ? 'setup.cfg' : `${dir}/setup.cfg`;
    if (allFiles.includes(cfg)) {
      let section = '';
      let continuation = false;
      for (const line of readFileSync(resolve(root, cfg), 'utf8').split(/\r?\n/)) {
        const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (line.trim().startsWith('[') && !heading) {
          warn(cfg, 'Malformed setup.cfg section.');
          continue;
        }
        if (heading) {
          section = heading[1];
          continuation = false;
          continue;
        }
        const item = /^([\w.-]+)\s*=\s*(.*)$/.exec(line);
        if (item) {
          continuation = section === 'options' && item[1] === 'install_requires';
          if (section === 'metadata' && item[1] === 'name') name = item[2].trim();
          if (continuation && item[2]) add(item[2], 'runtime', cfg);
        } else if (continuation && /^\s+\S/.test(line)) add(line, 'runtime', cfg);
        else if (line.trim() && !/^\s*[#;]/.test(line)) {
          continuation = false;
          if (section === '') warn(cfg, 'Malformed setup.cfg entry.');
        }
      }
    }
    if (allFiles.includes(pyproject)) {
      try {
        const parse = (
          createRequire(import.meta.url)('smol-toml') as { parse: (s: string) => unknown }
        ).parse;
        const data = object(parse(readFileSync(resolve(root, pyproject), 'utf8')));
        const project = object(data.project);
        const poetry = object(object(data.tool).poetry);
        if (project.name !== undefined && typeof project.name !== 'string')
          warn(pyproject, 'Project name must be a string.');
        if (
          project.dependencies !== undefined &&
          (!Array.isArray(project.dependencies) ||
            project.dependencies.some((item) => typeof item !== 'string'))
        )
          warn(pyproject, 'Project dependencies must be an array of requirement strings.');

        if (typeof project.name === 'string') name = project.name;
        else if (typeof poetry.name === 'string') name = poetry.name;
        const list = (value: unknown, group: string): void => {
          if (Array.isArray(value))
            for (const raw of value) if (typeof raw === 'string') add(raw, group, pyproject);
        };
        const addPoetry = (dep: string, value: unknown, group: string): void => {
          const details = object(value);
          const version =
            typeof value === 'string'
              ? value
              : typeof details.version === 'string'
                ? details.version
                : '';
          const location = [details.url, details.git, details.path].find(
            (item): item is string => typeof item === 'string',
          );
          add(dep, group, pyproject);
          const declaration = declarations.at(-1);
          if (declaration)
            declaration.requirement =
              dep + (location ? ` @ ${location}` : version === '*' ? '' : version);
        };
        if (Array.isArray(project.dependencies)) list(project.dependencies, 'runtime');
        else
          for (const [dep, value] of Object.entries(object(poetry.dependencies))) {
            if (!['python'].includes(dep)) addPoetry(dep, value, 'runtime');
          }
        for (const [group, value] of Object.entries(object(project['optional-dependencies'])))
          list(value, group);
        for (const [group, groupData] of Object.entries(object(poetry.group)))
          for (const [dep, value] of Object.entries(object(object(groupData).dependencies)))
            addPoetry(dep, value, `dev:${group}`);
        for (const [dep, value] of Object.entries(object(poetry['dev-dependencies'])))
          addPoetry(dep, value, 'dev');
        const groups = object(data['dependency-groups']);
        const visit = (group: string, stack: string[]): void => {
          if (stack.includes(group)) {
            warn(pyproject, `Dependency group cycle: ${[...stack, group].join(' -> ')}`);
            return;
          }
          const value = groups[group];
          if (!Array.isArray(value)) {
            warn(pyproject, `Unknown dependency group: ${group}`);
            return;
          }
          for (const item of value)
            if (typeof item === 'string') add(item, `dev:${stack[0] ?? group}`, pyproject);
            else if (typeof object(item)['include-group'] === 'string')
              visit(object(item)['include-group'] as string, [...stack, group]);
        };
        for (const group of Object.keys(groups).sort()) visit(group, []);
        for (const [command, target] of Object.entries(object(project.scripts)))
          if (typeof target === 'string') entrypoints.push({ name: command, target });
      } catch (error) {
        warn(
          pyproject,
          `Cannot parse Python manifest: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const readRequirements = (file: string, group: string, stack: string[]): void => {
      if (stack.includes(file)) {
        warn(file, 'Requirements include cycle.');
        return;
      }
      try {
        const actual = relative(realpathSync(root), realpathSync(resolve(root, file)));
        if (isAbsolute(actual) || actual === '..' || actual.startsWith('../')) {
          warn(file, 'Requirements include escapes the project.');
          return;
        }
        if (!allFiles.includes(file)) {
          warn(file, 'Requirements include is outside the discovered file set.');
          return;
        }
        const source = readFileSync(resolve(root, file), 'utf8').replace(/\\\r?\n/g, '');
        for (const raw of source.split(/\r?\n/)) {
          const line = raw.trim();
          const include = /^(?:-r\s*|--requirement(?:=|\s+))(.+)$/.exec(line);
          if (include) {
            const target = relative(
              root,
              resolve(root, dirname(file), include[1].trim()),
            ).replaceAll('\\', '/');
            readRequirements(target, group, [...stack, file]);
          } else if (
            !line.startsWith('#') &&
            (!line.startsWith('-') || /^(-e\s|--editable)/.test(line))
          )
            add(line.replace(/^(?:-e\s+|--editable(?:=|\s+))/, ''), group, file);
        }
      } catch {
        warn(file, 'Cannot read requirements include.');
      }
    };
    for (const file of requirements.filter((p) => requirementOwner(p) === dir))
      readRequirements(file, development(basename(file)) ? 'dev' : 'runtime', []);
    const locks = [
      ['uv.lock', 'uv'],
      ['poetry.lock', 'poetry'],
      ['pdm.lock', 'pdm'],
      ['Pipfile.lock', 'pipenv'],
    ].filter(([file]) => allFiles.includes(dir === '.' ? file : `${dir}/${file}`));
    if (locks.length > 1) warn(dir, 'Multiple Python lockfiles; using ' + locks[0][1] + '.');
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};
    declarations.sort((a, b) =>
      (a.name + '\0' + a.source + '\0' + a.group + '\0' + a.requirement).localeCompare(
        b.name + '\0' + b.source + '\0' + b.group + '\0' + b.requirement,
      ),
    );
    for (const decl of declarations) {
      const target =
        development(decl.group) || decl.group.startsWith('dev:') ? devDependencies : dependencies;
      if (!Object.hasOwn(target, decl.name))
        target[decl.name] =
          (decl.requirement.startsWith(decl.writtenName)
            ? decl.requirement.slice(decl.writtenName.length).trim()
            : decl.requirement) || '*';
    }
    summaries.set(dir, {
      dependencies,
      devDependencies,
      ...(name ? { name } : {}),
      manager: locks[0]?.[1] ?? (requirements.some((p) => dirname(p) === dir) ? 'pip' : undefined),
    });
    if (dirs.includes(dir))
      packages.push({
        path: dir,
        ecosystem: 'python',
        ...(name ? { name: normalizeName(name) } : {}),
        private: false,
        scripts: {},
        dependencies: [...new Set(declarations.map((d) => d.name))].sort(),
        dependencyDeclarations: declarations,
        entrypoints: entrypoints.sort((a, b) => a.name.localeCompare(b.name)),
      });
  }
  const primary = summaries.get('.') ?? summaries.values().next().value;
  if (!primary) return undefined;
  return {
    ...(primary.name ? { name: primary.name } : {}),
    ...(primary.manager ? { packageManager: primary.manager } : {}),
    dependencies: primary.dependencies,
    devDependencies: primary.devDependencies,
    scripts: {},
    packages,
    diagnostics,
  };
}
