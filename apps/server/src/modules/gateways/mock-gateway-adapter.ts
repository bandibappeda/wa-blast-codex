import type {
  GatewayAdapter,
  GatewayConnectionConfig,
  GatewayHealth,
  GatewayValidationResult,
  GatewayWebhookRequest,
  NormalizedGatewayEvent,
  SendMessageCommand,
  SendMessageResult,
} from "./gateway-adapter";

export class MockGatewayAdapter implements GatewayAdapter {
  readonly type = "mock";
  private readonly scripts = new Map<string, SendMessageResult>();
  private readonly results = new Map<string, SendMessageResult>();
  private sequence = 0;

  get sentCount(): number {
    return [...this.results.values()].filter((result) => result.kind === "sent").length;
  }

  script(idempotencyKey: string, result: SendMessageResult): void {
    this.scripts.set(idempotencyKey, result);
  }

  async validateConnection(connection: GatewayConnectionConfig): Promise<GatewayValidationResult> {
    return connection.senderIdentity ? { valid: true } : { valid: false, error: "sender_identity_required" };
  }

  async checkHealth(connection: GatewayConnectionConfig): Promise<GatewayHealth> {
    return connection.senderIdentity ? { status: "healthy" } : { status: "unhealthy", message: "sender_identity_required" };
  }

  async sendMessage(command: SendMessageCommand): Promise<SendMessageResult> {
    const previous = this.results.get(command.idempotencyKey);
    if (previous) return previous;
    const scripted = this.scripts.get(command.idempotencyKey);
    const result = scripted ?? { kind: "sent" as const, providerMessageId: `mock-${++this.sequence}` };
    this.results.set(command.idempotencyKey, result);
    return result;
  }

  async normalizeWebhook(request: GatewayWebhookRequest): Promise<NormalizedGatewayEvent[]> {
    const status = request.status.toLowerCase();
    if (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed") return [];
    const event: NormalizedGatewayEvent = { idempotencyKey: request.idempotencyKey, status };
    if (request.eventId !== undefined) event.eventId = request.eventId;
    if (request.providerMessageId !== undefined) event.providerMessageId = request.providerMessageId;
    if (request.raw !== undefined) event.raw = request.raw;
    return [event];
  }
}
