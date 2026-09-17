const VARIABLE_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const RESERVED_VARIABLES = new Set(["__proto__", "constructor", "prototype"]);

export class TemplateVariableError extends Error {
  constructor(readonly code: "malformed_variable" | "reserved_variable") { super(code); }
}

export function extractTemplateVariables(body: string): string[] {
  const variables: string[] = [];
  let cursor = 0;
  VARIABLE_PATTERN.lastIndex = 0;
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    const index = match.index ?? 0;
    if (/[{}]/.test(body.slice(cursor, index))) throw new TemplateVariableError("malformed_variable");
    const variable = match[1];
    if (!variable || RESERVED_VARIABLES.has(variable)) throw new TemplateVariableError("reserved_variable");
    if (!variables.includes(variable)) variables.push(variable);
    cursor = index + match[0].length;
  }
  if (/[{}]/.test(body.slice(cursor))) throw new TemplateVariableError("malformed_variable");
  return variables;
}

export function renderTemplate(body: string, attributes: Record<string, string>): string {
  extractTemplateVariables(body);
  return body.replace(VARIABLE_PATTERN, (token, variable: string) => attributes[variable] ?? token);
}

export function previewTemplate(body: string, attributes: Record<string, string>): {
  variables: string[];
  missing: string[];
  rendered: string;
  characterCount: number;
} {
  const variables = extractTemplateVariables(body);
  const rendered = renderTemplate(body, attributes);
  return {
    variables,
    missing: variables.filter((variable) => attributes[variable] === undefined),
    rendered,
    characterCount: rendered.length,
  };
}
