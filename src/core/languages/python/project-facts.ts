import type { ModuleRecord } from '../../discovery/discovery.js';
import { emptyProjectFacts } from '../shared.js';
import type { LanguageContext, LanguageProjectFacts } from '../types.js';
import type { SyntaxFacts } from './syntax.js';

export function pythonProjectFacts(
  modules: ModuleRecord[],
  context: LanguageContext,
): LanguageProjectFacts {
  const facts = emptyProjectFacts();
  const routes = new Map<string, Set<string>>();
  const add = (path: string, methods: string[] = []): void => {
    const set = routes.get(path) ?? new Set<string>();
    for (const method of methods) set.add(method);
    routes.set(path, set);
  };
  for (const module of modules) {
    const syntax = (module.parseFacts as { syntax?: SyntaxFacts } | undefined)?.syntax;
    if (!syntax) continue;
    for (const name of syntax.environment)
      facts.environmentReads.push({ name, files: [module.path] });
    const owner = context.workspacePackages
      ?.filter(
        (p) => p.ecosystem === 'python' && (p.path === '.' || module.path.startsWith(p.path + '/')),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    const imports = Object.values(syntax.bindings);
    const has = (name: string): boolean =>
      imports.some((i) => i === name || i.startsWith(name + '.'));
    const methods = (args: string): string[] => {
      const list = /\bmethods\s*=\s*\[([^\]]*)\]/.exec(args);
      if (!list || !/^\s*(?:['"][A-Za-z]+['"]\s*,?\s*)*$/.test(list[1])) return [];
      return [...list[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((m) => m[1].toUpperCase());
    };
    for (const decorator of syntax.decorators) {
      const verb = decorator.callee.split('.').at(-1) ?? '';
      if (
        (has('fastapi') || has('flask') || has('starlette')) &&
        /^(get|post|put|patch|delete|head|options|trace|route|api_route)$/.test(verb)
      )
        add(
          module.path,
          /^(route|api_route)$/.test(verb) ? methods(decorator.arguments) : [verb.toUpperCase()],
        );
    }
    if (has('starlette'))
      for (const registration of syntax.registrations) {
        const [head, ...rest] = registration.callee.split('.');
        const target = [syntax.bindings[head] ?? head, ...rest].join('.');
        if (target === 'starlette.routing.Route' && /^\s*['"]/.test(registration.arguments)) {
          add(module.path, methods(registration.arguments));
          const endpoint = /\bendpoint\s*=\s*([\w.]+)/.exec(registration.arguments)?.[1];
          if (endpoint) {
            const binding = syntax.bindings[endpoint.split('.')[0]];
            if (binding)
              for (const [specifier, path] of Object.entries(module.resolvedImportMap ?? {}))
                if (binding === specifier || binding.startsWith(specifier + '.'))
                  add(path, methods(registration.arguments));
          }
        }
      }
    if (has('django') && /(?:^|\/)urls\.py$/.test(module.path)) {
      add(module.path);
      for (const registration of syntax.registrations) {
        const [head, ...tail] = registration.callee.split('.');
        const callee = [syntax.bindings[head] ?? head, ...tail].join('.');
        if (!['django.urls.path', 'django.urls.re_path'].includes(callee)) continue;
        const view = /^\s*(['"])(?:\\.|(?!\1)[^\\])*?\1\s*,\s*([\w.]+)/.exec(
          registration.arguments,
        )?.[2];
        if (!view) continue;
        const [binding, ...members] = view.split('.');
        const target = [syntax.bindings[binding] ?? '', ...members].join('.');
        const resolved = Object.entries(module.resolvedImportMap ?? {})
          .filter(([specifier]) => target === specifier || target.startsWith(specifier + '.'))
          .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
        if (resolved && modules.some((m) => m.path === resolved)) add(resolved);
      }
    }
    if (/(?:^|\/)__main__\.py$/.test(module.path)) add(module.path);
    if (owner)
      for (const entrypoint of owner.entrypoints ?? []) {
        const target = entrypoint.target.split(':')[0].replaceAll('.', '/');
        const base = owner.path === '.' ? '' : owner.path + '/';
        if (
          [
            `${base}${target}.py`,
            `${base}src/${target}.py`,
            `${base}${target}/__init__.py`,
            `${base}src/${target}/__init__.py`,
          ].includes(module.path)
        )
          add(module.path);
      }
  }
  facts.routeHandlers = [...routes.keys()].sort();
  facts.routeDetails = facts.routeHandlers.map((path) => ({
    path,
    methods: [...(routes.get(path) ?? [])].sort(),
  }));
  return facts;
}
