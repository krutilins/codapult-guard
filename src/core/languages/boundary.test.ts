import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const sourceRoot = resolve(import.meta.dirname, '../..');

/** Checks imports as well as runtime parser loads; tests may inspect concrete implementations. */
function violations(path: string, source: string): string[] {
  const errors: string[] = [];
  const inLanguages = path.startsWith('core/languages/');
  const inEcosystems = path.startsWith('core/ecosystems/');
  if (
    !inLanguages &&
    /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:ts-morph|@lezer\/python)['"]/.test(source)
  )
    errors.push('parser dependency outside languages');
  if (
    !inLanguages &&
    /(?:===?|!==?)\s*['"](?:python|js-ts)['"]|['"](?:python|js-ts)['"]\s*(?:===?|!==?)|case\s+['"](?:python|js-ts)['"]/.test(
      source,
    )
  )
    errors.push('language branch outside languages');
  for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
    const target = match[1].startsWith('.')
      ? relative(sourceRoot, resolve(sourceRoot, dirname(path), match[1]))
      : match[1];
    for (const layer of ['languages', 'ecosystems']) {
      const concrete = new RegExp(`^core/${layer}/(?:js-ts|python|npm)/`).exec(target);
      if (concrete && path !== `core/${layer}/index.ts` && !path.startsWith(concrete[0]))
        errors.push(`concrete ${layer} dependency outside registry`);
    }
  }
  if (
    !inEcosystems &&
    !['core/verification/verify.ts', 'mcp/server.ts'].includes(path) &&
    /(?:readFileSync|readJsonObject|require)\s*\([\s\S]{0,180}?['"][^'"]*package\.json['"]/.test(
      source,
    )
  )
    errors.push('manifest read outside ecosystems');
  return errors;
}

describe('language and ecosystem architecture boundaries', () => {
  it('keeps production sources within their declared layers', () => {
    const files = readdirSync(sourceRoot, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    );
    const errors = files.flatMap((entry) => {
      const absolute = resolve(entry.parentPath, entry.name);
      const path = relative(sourceRoot, absolute);
      return violations(path, readFileSync(absolute, 'utf8')).map((error) => `${path}: ${error}`);
    });
    expect(errors).toEqual([]);
  });
  it.each([
    ["import { Project } from 'ts-morph';", 'parser dependency outside languages'],
    ["const parser = require('@lezer/python');", 'parser dependency outside languages'],
    ["if (sourceLanguage(path) === 'python') {}", 'language branch outside languages'],
    [
      "import { pythonBackend } from './languages/python/index.js';",
      'concrete languages dependency outside registry',
    ],
    [
      "import { npmEcosystem } from './ecosystems/npm/index.js';",
      'concrete ecosystems dependency outside registry',
    ],
    ["readFileSync(resolve(root, 'package.json'), 'utf8');", 'manifest read outside ecosystems'],
  ])('rejects a deliberate violation: %s', (source, message) => {
    expect(violations('core/guard.ts', source)).toContain(message);
  });
});
