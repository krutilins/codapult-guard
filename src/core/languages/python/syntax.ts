/** Backend-owned syntax evidence. No Python expression is evaluated. */
export interface SyntaxFacts {
  calls: string[];
  decorators: { callee: string; arguments: string }[];
  bindings: Record<string, string>;
  environment: string[];
  registrations: { callee: string; arguments: string }[];
}
export function syntaxFacts(
  source: string,
  tree: {
    cursor(): {
      name: string;
      from: number;
      to: number;
      node: {
        parent: { name: string; firstChild?: { from: number; to: number } | null } | null;
        firstChild: { from: number; to: number } | null;
      };
      next(): boolean;
    };
  },
): SyntaxFacts {
  const result: SyntaxFacts = {
    calls: [],
    decorators: [],
    bindings: {},
    environment: [],
    registrations: [],
  };
  const cursor = tree.cursor();
  const members: string[] = [];
  const candidates: { callee: string; from: number; to: number }[] = [];
  do {
    const text = source.slice(cursor.from, cursor.to).trim();
    if (cursor.name === 'ImportStatement') {
      const from = /^from\s+([\w.]+)\s+import\s+([\s\S]+)$/.exec(text);
      if (from)
        for (const item of from[2].replace(/[()]/g, '').split(',')) {
          const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(item);
          if (m) result.bindings[m[2] ?? m[1]] = `${from[1]}.${m[1]}`;
        }
      else if (text.startsWith('import '))
        for (const item of text.slice(7).split(',')) {
          const m = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(item);
          if (m) result.bindings[m[2] ?? m[1].split('.')[0]] = m[2] ? m[1] : m[1].split('.')[0];
        }
    }
    if (cursor.name === 'Decorator') {
      const match = /^@\s*([\w.]+)\s*(?:\(([\s\S]*)\))?$/.exec(text);
      if (match) result.decorators.push({ callee: match[1], arguments: match[2] ?? '' });
    }
    if (cursor.name === 'CallExpression') {
      const callee = cursor.node.firstChild
        ? source.slice(cursor.node.firstChild.from, cursor.node.firstChild.to).trim()
        : '';
      if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(callee)) {
        if (cursor.node.parent?.name !== 'Decorator') result.calls.push(callee);
        candidates.push({ callee, from: cursor.from, to: cursor.to });
      }
    }
    if (cursor.name === 'MemberExpression') {
      const parent = cursor.node.parent;
      const assigned =
        parent?.name === 'AssignStatement' &&
        parent.firstChild?.from === cursor.from &&
        parent.firstChild.to === cursor.to;
      if (!assigned) members.push(text);
    }
  } while (cursor.next());
  const canonical = (callee: string): string => {
    const [head, ...tail] = callee.split('.');
    return Object.hasOwn(result.bindings, head) ? [result.bindings[head], ...tail].join('.') : '';
  };
  for (const call of candidates) {
    if (
      [
        'os.getenv',
        'os.environ.get',
        'starlette.routing.Route',
        'django.urls.path',
        'django.urls.re_path',
      ].includes(canonical(call.callee))
    ) {
      const text = source.slice(call.from, call.to);
      result.registrations.push({
        callee: call.callee,
        arguments: text.slice(text.indexOf('(') + 1, -1),
      });
    }
  }
  const literal = (text: string): string | undefined => {
    const m = /^\s*(['"])([A-Z][A-Z0-9_]*)\1\s*(?:,|$)/.exec(text);
    return m?.[2];
  };
  for (const call of result.registrations)
    if (['os.getenv', 'os.environ.get'].includes(canonical(call.callee))) {
      const name = literal(call.arguments);
      if (name) result.environment.push(name);
    }
  for (const member of members) {
    const m = /^([\w.]+)\[\s*(['"])([A-Z][A-Z0-9_]*)\2\s*\]$/.exec(member);
    if (m && canonical(m[1]) === 'os.environ') result.environment.push(m[3]);
  }
  result.calls = [...new Set(result.calls)].sort();
  result.environment = [...new Set(result.environment)].sort();
  return result;
}
