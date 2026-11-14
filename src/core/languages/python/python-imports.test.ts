import { describe, expect, it } from 'vitest';
import { parsePythonSource, type PythonImportFact } from './python-imports.js';

function imports(source: string): PythonImportFact[] {
  return parsePythonSource(source).imports;
}

describe('parsePythonSource', () => {
  it('extracts plain imports, dotted modules, and aliases', () => {
    const result = parsePythonSource(
      ['import os', 'import os.path as osp, json', 'import a.b.c', ''].join('\n'),
    );

    expect(result.imports).toEqual([
      { module: 'os', line: 1 },
      { module: 'os.path', line: 2 },
      { module: 'json', line: 2 },
      { module: 'a.b.c', line: 3 },
    ]);
    expect(result.importedSymbols).toEqual(['os', 'osp', 'json', 'a']);
  });

  it('extracts from imports with aliases, stars, and multiline parentheses', () => {
    const result = parsePythonSource(
      [
        'from app.db import models, session as db_session',
        'from typing import *',
        'from app.services import (',
        '    UserService,  # trailing comment',
        '    BillingService as Billing,',
        ')',
        '',
      ].join('\n'),
    );

    expect(result.imports).toEqual([
      { module: 'app.db', names: ['models', 'session'], line: 1 },
      { module: 'typing', names: [], line: 2 },
      { module: 'app.services', names: ['UserService', 'BillingService'], line: 3 },
    ]);
    expect(result.importedSymbols).toEqual(['models', 'db_session', 'UserService', 'Billing']);
  });

  it('records relative levels, including the ellipsis token for level 3', () => {
    expect(
      imports(
        [
          'from . import a, b',
          'from .sibling import x',
          'from .. import parent',
          'from ..pkg.mod import y',
          'from ... import top',
          'from ....deep import z',
          'from .....deeper import w',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      { module: '.', names: ['a', 'b'], line: 1 },
      { module: '.sibling', names: ['x'], line: 2 },
      { module: '..', names: ['parent'], line: 3 },
      { module: '..pkg.mod', names: ['y'], line: 4 },
      { module: '...', names: ['top'], line: 5 },
      { module: '....deep', names: ['z'], line: 6 },
      { module: '.....deeper', names: ['w'], line: 7 },
    ]);
  });

  it('ignores the word import in comments, strings, docstrings, and dynamic import calls', () => {
    const result = parsePythonSource(
      [
        '"""Module docstring: import fake_docstring."""',
        '# import fake_comment',
        'text = "import fake_string"',
        "template = f'from {x} import fake_fstring'",
        'import importlib',
        'plugin = importlib.import_module("plugins.fake_dynamic")',
        'legacy = __import__("fake_dunder")',
        'import real',
        '',
      ].join('\n'),
    );

    expect(result.imports).toEqual([
      { module: 'importlib', line: 5 },
      { module: 'real', line: 8 },
    ]);
    expect(result.errorLines).toEqual([]);
  });

  it('extracts imports in every block, including TYPE_CHECKING and decorated nested functions', () => {
    expect(
      imports(
        [
          'from typing import TYPE_CHECKING',
          'if TYPE_CHECKING:',
          '    from app.models import User',
          'try:',
          '    import ujson as json',
          'except ImportError:',
          '    import json',
          'class Service:',
          '    def run(self):',
          '        from app.tasks import enqueue',
          'def outer():',
          '    @cache',
          '    def inner():',
          '        import app.cache',
          '    return inner',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      { module: 'typing', names: ['TYPE_CHECKING'], line: 1 },
      { module: 'app.models', names: ['User'], line: 3 },
      { module: 'ujson', line: 5 },
      { module: 'json', line: 7 },
      { module: 'app.tasks', names: ['enqueue'], line: 10 },
      { module: 'app.cache', line: 14 },
    ]);
  });

  it('counts top-level declarations only', () => {
    const result = parsePythonSource(
      [
        'import os',
        'x = 1',
        'y: int = 2',
        'a = b = 3',
        'x += 1',
        'async def fetch(): pass',
        'def run(): pass',
        '@dataclass',
        'class Model: pass',
        'class Box[T]: pass',
        'def identity[T](value: T) -> T: return value',
        'type Alias = int',
        'if os.name == "nt":',
        '    def windows_only(): pass',
        '',
      ].join('\n'),
    );

    expect(result.declarations).toEqual({
      classes: 2,
      functions: 3,
      interfaces: 0,
      types: 1,
      variables: 3,
    });
    expect(result.errorLines).toEqual([]);
  });

  it('keeps imports after grammar gaps and syntax errors, with correct lines', () => {
    const result = parsePythonSource(
      [
        'def gen():',
        '    yield',
        'import after_yield',
        'with open(a) as (left, right):',
        '    pass',
        'import after_with',
        'def unpack(*args: *Ts): pass',
        'import after_pep646',
        'def broken(:',
        '    pass',
        'import after_invalid',
        'greeting = t"hello {name}"',
        'import after_tstring',
        'lazy import lazy_module',
        'import after_lazy',
        '',
      ].join('\n'),
    );

    expect(result.imports.map((fact) => [fact.module, fact.line])).toEqual([
      ['after_yield', 3],
      ['after_with', 6],
      ['after_pep646', 8],
      ['after_invalid', 11],
      ['after_tstring', 13],
      ['lazy_module', 14],
      ['after_lazy', 15],
    ]);
    expect(result.errorLines.length).toBeGreaterThan(0);
    expect(result.errorLines.length).toBeLessThanOrEqual(5);
    expect(result.errorLines).toEqual([...result.errorLines].sort((a, b) => a - b));
  });

  it('parses PEP 695 generics, match, and modern syntax without errors', () => {
    const result = parsePythonSource(
      [
        'from collections.abc import Callable',
        'class Registry[K, V]:',
        '    def get[T](self, key: K) -> V | T: ...',
        'type Handler[T] = Callable[[T], None]',
        'match command:',
        '    case {"action": action}:',
        '        from app.actions import dispatch',
        'if (count := len(items)) > 1:',
        '    pass',
        'try:',
        '    pass',
        'except* ValueError:',
        '    pass',
        'message = f"{f"{nested}"}"',
        '',
      ].join('\n'),
    );

    expect(result.imports).toEqual([
      { module: 'collections.abc', names: ['Callable'], line: 1 },
      { module: 'app.actions', names: ['dispatch'], line: 7 },
    ]);
    expect(result.errorLines).toEqual([]);
  });

  it('fabricates no import from incomplete statements', () => {
    const result = parsePythonSource(
      [
        'import',
        'from import x',
        'from . import',
        'from pkg. import y',
        'from pkg import (a, b',
        'import complete',
        '',
      ].join('\n'),
    );

    expect(result.imports).toEqual([{ module: 'complete', line: 6 }]);
    expect(result.errorLines.length).toBeGreaterThan(0);
  });

  it('accepts statements after a semicolon, a colon, or the lazy keyword', () => {
    expect(
      imports(['x = 1; import a', 'if x: import b', 'try: from c import d', ''].join('\n')),
    ).toEqual([
      { module: 'a', line: 1 },
      { module: 'b', line: 2 },
      { module: 'c', names: ['d'], line: 3 },
    ]);
  });

  it('returns deterministic facts for the same source', () => {
    const source = 'from .a import b\nimport c.d as e\n';

    expect(parsePythonSource(source)).toEqual(parsePythonSource(source));
  });
});
