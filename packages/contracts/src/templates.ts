import { z } from "zod";

export const templateBodySchema = z.string().min(1).max(10_000);

export const templateCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  body: templateBodySchema,
  attachmentId: z.string().trim().min(1).nullable().optional(),
});

export const templateUpdateRequestSchema = templateCreateRequestSchema.partial();

export const templatePreviewRequestSchema = z.object({
  body: templateBodySchema,
  attributes: z.record(z.string(), z.string()).default({}),
});

export type TemplateCreateRequest = z.infer<typeof templateCreateRequestSchema>;
export type TemplateUpdateRequest = z.infer<typeof templateUpdateRequestSchema>;
