export type ProjectedDeliveryStatus = "pending" | "leased" | "sent" | "delivered" | "read" | "failed" | "cancelled";
export type IncomingDeliveryStatus = "sent" | "delivered" | "read" | "failed";

const rank: Record<ProjectedDeliveryStatus, number> = { pending: 0, leased: 1, sent: 2, delivered: 3, read: 4, failed: 5, cancelled: 6 };

export function projectDeliveryStatus(current: ProjectedDeliveryStatus, incoming: IncomingDeliveryStatus, currentProviderMessageId?: string | null, incomingProviderMessageId?: string | null): ProjectedDeliveryStatus {
  const sameProvider = currentProviderMessageId !== null
    && currentProviderMessageId !== undefined
    && incomingProviderMessageId !== null
    && incomingProviderMessageId !== undefined
    && currentProviderMessageId === incomingProviderMessageId;
  if (current === "cancelled") return current;
  if (current === "failed" && incoming !== "failed" && currentProviderMessageId !== incomingProviderMessageId) return current;
  if (current === "read" && incoming !== "read") return current;
  if (incoming === "failed") return current === "read" ? current : "failed";
  return rank[incoming] > rank[current] || (current === "failed" && sameProvider) ? incoming : current;
}
