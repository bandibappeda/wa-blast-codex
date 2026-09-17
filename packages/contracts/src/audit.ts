import { z } from "zod";

export const auditQuerySchema = z.object({
  actorId: z.string().trim().max(100).optional(),
  action: z.string().trim().max(120).optional(),
  subjectType: z.string().trim().max(100).optional(),
  subjectId: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
