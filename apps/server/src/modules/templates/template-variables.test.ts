import { describe, expect, test } from "bun:test";
import { TemplateVariableError, extractTemplateVariables, previewTemplate, renderTemplate } from "./template-variables";

describe("template variables", () => {
  test("extracts safe variables and renders a preview", () => {
    const body = "Halo {{name}}, pesanan {{order_id}} siap.";
    expect(extractTemplateVariables(body)).toEqual(["name", "order_id"]);
    expect(renderTemplate(body, { name: "Ani", order_id: "ORD-7" })).toBe("Halo Ani, pesanan ORD-7 siap.");
    expect(previewTemplate(body, { name: "Ani" })).toEqual({
      variables: ["name", "order_id"],
      missing: ["order_id"],
      rendered: "Halo Ani, pesanan {{order_id}} siap.",
      characterCount: 36,
    });
  });

  test("rejects malformed, nested, and executable-looking expressions", () => {
    for (const body of ["Halo {{name", "Halo name}}", "Halo {{contact.name}}", "Halo {{name {{nested}}}}", "{{constructor}}()"])
      expect(() => extractTemplateVariables(body)).toThrow(TemplateVariableError);
  });
});
