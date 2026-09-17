interface TemplatePreviewProps {
  body: string;
  sampleAttributes: Record<string, string>;
}

export function TemplatePreview({ body, sampleAttributes }: TemplatePreviewProps) {
  const variables = extractVariables(body);
  const missing = variables.filter((variable) => sampleAttributes[variable] === undefined);
  const rendered = body.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (token, variable: string) => sampleAttributes[variable] ?? token);
  return <div className="template-preview" aria-label="Template preview">
    <div className="preview-header"><div><div className="eyebrow">LIVE PREVIEW</div><h3>Rendered message</h3></div><span className="toolbar-note">{rendered.length} characters</span></div>
    <p className="preview-message">{rendered || "Start writing a message to see the preview."}</p>
    <p className="toolbar-note">Sample values shown for preview only.</p>
    {variables.length ? <div className="variable-summary"><span className="eyebrow">VARIABLES</span><div>{variables.map((variable) => <span key={variable} className={missing.includes(variable) ? "variable-chip is-missing" : "variable-chip"}>{variable}{missing.includes(variable) ? " · missing" : ""}</span>)}</div></div> : null}
  </div>;
}

function extractVariables(body: string): string[] {
  return [...body.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]).filter((value, index, all) => value !== undefined && all.indexOf(value) === index) as string[];
}
