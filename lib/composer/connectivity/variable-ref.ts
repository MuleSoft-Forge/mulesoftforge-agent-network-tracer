const VAR_REF = /^\$\{([a-zA-Z][a-zA-Z0-9_.-]*)\.([a-zA-Z][a-zA-Z0-9_.-]*)\}$/;

export function formatVariableRef(group: string, field: string): string {
  return `\${${group}.${field}}`;
}

export function parseVariableRef(value: string): { group: string; field: string } | null {
  const m = value.match(VAR_REF);
  if (!m) return null;
  return { group: m[1], field: m[2] };
}

export function isVariableRef(value: string): boolean {
  return VAR_REF.test(value);
}
