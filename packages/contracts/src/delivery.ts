import { z } from "zod";

export const gatewayWebhookRequestSchema = z.object({
  eventId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(100),
  providerMessageId: z.string().trim().min(1).max(200).optional(),
  raw: z.unknown().optional(),
});

export type GatewayWebhookRequest = z.infer<typeof gatewayWebhookRequestSchema>;

export const deliveryResultStatusSchema = z.enum([
  "pending",
  "retrying",
  "leased",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
]);

export const deliveryResultsQuerySchema = z.object({
  status: deliveryResultStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type DeliveryResultsQuery = z.infer<typeof deliveryResultsQuerySchema>;
