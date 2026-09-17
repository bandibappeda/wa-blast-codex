import { z } from "zod";

export const contactCreateRequestSchema = z.object({
  phone: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  consentSource: z.string().trim().min(1).max(200),
  consentAt: z.string().datetime({ offset: true }),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  attributes: z.record(z.string(), z.string()).default({}),
});

export const contactImportPreviewRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().max(5_000_000),
});

export const suppressionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type ContactCreateRequest = z.infer<typeof contactCreateRequestSchema>;
export type ContactImportPreviewRequest = z.infer<typeof contactImportPreviewRequestSchema>;
