import { createRequire } from 'node:module';
import type { parser as LezerPythonParser } from '@lezer/python';

type PythonParser = typeof LezerPythonParser;
type TreeCursor = ReturnType<ReturnType<PythonParser['parse']>['cursor']>;

/** One Python import statement entry, as written. */
export interface PythonImportFact {
  /** Module spelling with leading dots for relative imports: `a.b`, `.`, `..pkg.mod`. */
  module: string;
  /** Imported names of a `from` import, without `*` (empty for `from M import *`). Absent for `import a.b`. */
  names?: string[] | undefined;
  /** 1-based line of the statement. */
  line: number;
}

export interface PythonParseResult {
  imports: PythonImportFact[];
  /** Local binding names: the alias if present, otherwise the imported name or first segment. */
  importedSymbols: string[];
  declarations: {
    classes: number;
    functions: number;
    interfaces: number;
    types: number;
    variables: number;
  };
  /** Up to 5 distinct 1-based lines that contain error nodes (D3). */
  errorLines: number[];
}

const MAX_ERROR_LINES = 5;

let loadedParser: PythonParser | undefined;

/** Loads `@lezer/python` on first use, so projects without `.py` files never load it. */
function pythonParser(): PythonParser {
  if (!loadedParser) {
    const require = createRequire(import.meta.url);
    loadedParser = (require('@lezer/python') as { parser: PythonParser }).parser;
  }
  return loadedParser;
}

export function isPythonParserLoaded(): boolean {
  return loadedParser !== undefined;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: number[], position: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

interface Token {
  name: string;
  text: string;
  error: boolean;
}

function childTokens(cursor: TreeCursor, source: string): Token[] {
  const tokens: Token[] = [];
  const child = cursor.node.cursor();
  if (child.firstChild()) {
    do {
      tokens.push({
        name: child.name,
        text: source.slice(child.from, child.to),
        error: child.type.isError,
      });
    } while (child.nextSibling());
  }
  return tokens;
}

/** `import a.b as c, d`: one fact per module; the binding is the alias or the first segment. */
function plainImport(tokens: Token[], line: number, result: PythonParseResult): void {
  let module = '';
  let alias: string | undefined;
  let afterAs = false;
  const flush = (): void => {
    if (module && !module.startsWith('.') && !module.endsWith('.')) {
      result.imports.push({ module, line });
      result.importedSymbols.push(alias ?? module.split('.')[0]);
    }
    module = '';
    alias = undefined;
    afterAs = false;
  };
  for (const token of tokens.slice(1)) {
    if (token.name === ',') flush();
    else if (token.name === 'as') afterAs = true;
    else if (token.name === 'VariableName' && afterAs) alias = token.text;
    else if (!afterAs && (token.name === 'VariableName' || token.name === '.')) {
      module += token.text;
    }
  }
  flush();
}

/** `from ..pkg import a as b, c` and `from M import *`. */
function fromImport(tokens: Token[], line: number, result: PythonParseResult): void {
  const importIndex = tokens.findIndex((token) => token.name === 'import');
  if (importIndex < 0) return;
  let level = 0;
  let module = '';
  for (const token of tokens.slice(1, importIndex)) {
    if (token.name === 'VariableName') module += token.text;
    else if (token.text === '...' && module === '') level += 3;
    else if (token.text === '.' && module === '') level += 1;
    else if (token.text === '.') module += '.';
  }
  if (module.endsWith('.') || (level === 0 && module === '')) return;
  const names: string[] = [];
  let pending: string | undefined;
  let afterAs = false;
  const flush = (): void => {
    if (pending !== undefined) {
      names.push(pending);
      result.importedSymbols.push(pending);
    }
    pending = undefined;
    afterAs = false;
  };
  for (const token of tokens.slice(importIndex + 1)) {
    if (token.name === ',') flush();
    else if (token.name === 'as') afterAs = true;
    else if (token.name === 'VariableName' && afterAs) {
      // The binding is the alias; the imported name stays the module-relative name.
      if (pending !== undefined) {
        names.push(pending);
        result.importedSymbols.push(token.text);
      }
      pending = undefined;
    } else if (token.name === 'VariableName') pending = token.text;
  }
  flush();
  result.imports.push({ module: `${'.'.repeat(level)}${module}`, names, line });
}

/**
 * Whether an import statement starts where Python allows a statement: at the start of a line,
 * after `;` or `:`, or after the `lazy` soft keyword. Error recovery can split `from import x`
 * into a separate `import x` that starts mid-line, which would fabricate a module.
 */
function atStatementStart(source: string, starts: number[], line: number, from: number): boolean {
  const prefix = source.slice(starts[line - 1], from).trim();
  return prefix === '' || /(?:^|[;:])\s*(?:lazy)?$/.test(prefix);
}

function countDeclaration(name: string, result: PythonParseResult): void {
  if (name === 'ClassDefinition') result.declarations.classes += 1;
  else if (name === 'FunctionDefinition') result.declarations.functions += 1;
  else if (name === 'TypeDefinition') result.declarations.types += 1;
  else if (name === 'AssignStatement') result.declarations.variables += 1;
}

/**
 * Extracts import statements and top-level declaration counts from Python source without
 * executing it. Imports in every block count (D5), and imports are kept from trees with error
 * nodes (D3). Calls such as `importlib.import_module()` are not imports.
 */
export function parsePythonSource(source: string): PythonParseResult {
  const tree = pythonParser().parse(source);
  const starts = lineStarts(source);
  const result: PythonParseResult = {
    imports: [],
    importedSymbols: [],
    declarations: { classes: 0, functions: 0, interfaces: 0, types: 0, variables: 0 },
    errorLines: [],
  };
  const errorLines = new Set<number>();
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) {
      errorLines.add(lineAt(starts, cursor.from));
      continue;
    }
    if (cursor.name !== 'ImportStatement') continue;
    const tokens = childTokens(cursor, source);
    const line = lineAt(starts, cursor.from);
    // A statement with its own error node is incomplete, so its spelling or names are unreliable.
    if (
      tokens.some((token) => token.error) ||
      !atStatementStart(source, starts, line, cursor.from)
    ) {
      continue;
    }
    if (tokens[0]?.name === 'import') plainImport(tokens, line, result);
    else if (tokens[0]?.name === 'from') fromImport(tokens, line, result);
  } while (cursor.next());

  const topLevel = tree.topNode.cursor();
  if (topLevel.firstChild()) {
    do {
      if (topLevel.name === 'DecoratedStatement') {
        const decorated = topLevel.node.lastChild;
        if (decorated) countDeclaration(decorated.name, result);
      } else countDeclaration(topLevel.name, result);
    } while (topLevel.nextSibling());
  }
  result.errorLines = [...errorLines].sort((left, right) => left - right).slice(0, MAX_ERROR_LINES);
  return result;
}
