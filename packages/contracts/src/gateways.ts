import { z } from "zod";

export const gatewayCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  adapterType: z.string().trim().min(1).max(50),
  senderIdentity: z.string().trim().min(1).max(100),
  credentials: z.record(z.string(), z.string()).default({}),
  messagesPerMinute: z.number().int().min(1).max(600).default(30),
});

export const gatewayTestMessageRequestSchema = z.object({
  recipientPhone: z.string().trim().min(1),
  body: z.string().min(1).max(10_000),
});

export const gatewayUpdateRequestSchema = gatewayCreateRequestSchema
  .partial()
  .extend({ enabled: z.boolean().optional() });

export type GatewayCreateRequest = z.infer<typeof gatewayCreateRequestSchema>;
export type GatewayUpdateRequest = z.infer<typeof gatewayUpdateRequestSchema>;
