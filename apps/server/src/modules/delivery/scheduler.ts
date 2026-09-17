import type { Database } from "bun:sqlite";
import type { Clock } from "../../shared/clock";

export class DeliveryScheduler {
  constructor(private readonly dependencies: { db: Database; clock: Clock }) {}

  advance(now = this.dependencies.clock.now()): number {
    const result = this.dependencies.db.query("UPDATE campaigns SET state = 'queued', updated_at = ? WHERE state = 'scheduled' AND schedule_at IS NOT NULL AND schedule_at <= ?").run(now.toISOString(), now.toISOString());
    return result.changes;
  }
}
