import type { GatewayAdapter } from "./gateway-adapter";

export class GatewayRegistry {
  private readonly adapters = new Map<string, GatewayAdapter>();

  register(adapter: GatewayAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): GatewayAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`gateway_adapter_not_registered:${type}`);
    return adapter;
  }
}
