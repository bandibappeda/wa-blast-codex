export interface GatewayConnectionConfig {
  id: string;
  type: string;
  senderIdentity: string;
  config: Record<string, string>;
}

export interface GatewayValidationResult {
  valid: boolean;
  error?: string;
}

export interface GatewayHealth {
  status: "healthy" | "unhealthy";
  message?: string;
}

export interface SendMessageCommand {
  connection: GatewayConnectionConfig;
  idempotencyKey: string;
  recipientPhone: string;
  body: string;
  attachment?: { storageKey: string; mimeType: string };
}

export type SendMessageResult =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "transient_failure"; code: string; message: string }
  | { kind: "permanent_failure"; code: string; message: string };

export interface GatewayWebhookRequest {
  eventId?: string;
  idempotencyKey: string;
  status: string;
  providerMessageId?: string;
  raw?: unknown;
}

export interface NormalizedGatewayEvent {
  eventId?: string;
  idempotencyKey: string;
  status: "sent" | "delivered" | "read" | "failed";
  providerMessageId?: string;
  raw?: unknown;
}

export interface GatewayAdapter {
  readonly type: string;
  validateConnection(connection: GatewayConnectionConfig): Promise<GatewayValidationResult>;
  checkHealth(connection: GatewayConnectionConfig): Promise<GatewayHealth>;
  sendMessage(command: SendMessageCommand): Promise<SendMessageResult>;
  normalizeWebhook(request: GatewayWebhookRequest): Promise<NormalizedGatewayEvent[]>;
}
