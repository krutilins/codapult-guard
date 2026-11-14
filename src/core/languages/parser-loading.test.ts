import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['python', 'js-ts'])('loads only the %s parser in a fresh process', (language) => {
  const root = mkdtempSync(join(tmpdir(), 'guard-parser-load-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(
    join(project, language === 'python' ? 'main.py' : 'main.ts'),
    language === 'python' ? 'import os\n' : 'export const value = 1;\n',
  );
  const source = pathToFileURL(resolve(import.meta.dirname, '../..')).href + '/';
  const packageUrl = pathToFileURL(resolve(import.meta.dirname, '../../../package.json')).href;
  // A test-only loader compiles source in the child, so this test never relies on a prior build.
  const loader = join(root, 'loader.mjs');
  writeFileSync(
    loader,
    `
    import { existsSync, readFileSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { fileURLToPath } from 'node:url';
    const ts = createRequire(${JSON.stringify(packageUrl)})('typescript');
    const source = ${JSON.stringify(source)};
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith(source) && specifier.endsWith('.js')) {
        const url = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
      return next(specifier, context);
    }
    export async function load(url, context, next) {
      if (url.startsWith(source) && url.endsWith('.ts')) return {format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText};
      return next(url, context);
    }
  `,
  );
  const script = `
    import { createRequire, register } from 'node:module';
    register(${JSON.stringify(pathToFileURL(loader).href)});
    const { discoverProject } = await import(${JSON.stringify(`${source}core/discovery/discovery.ts`)});
    discoverProject(${JSON.stringify(project)}, {persistCache: false});
    const cache = Object.keys(createRequire(${JSON.stringify(packageUrl)}).cache);
    console.log(JSON.stringify({python: cache.some((path) => path.includes('/@lezer/python/')), jsTs: cache.some((path) => path.includes('/ts-morph/'))}));
  `;
  const result = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
  ) as { python: boolean; jsTs: boolean };
  expect(result).toEqual({ python: language === 'python', jsTs: language === 'js-ts' });
});
