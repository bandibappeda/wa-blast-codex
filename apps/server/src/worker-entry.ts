import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { migrate } from "./db/migrate";
import { SystemClock } from "./shared/clock";
import { UuidGenerator } from "./shared/id";
import { CredentialVault } from "./modules/gateways/credential-vault";
import { GatewayRegistry } from "./modules/gateways/gateway-registry";
import { MockGatewayAdapter } from "./modules/gateways/mock-gateway-adapter";
import { GatewayService } from "./modules/gateways/gateway-service";
import { DeliveryWorker } from "./modules/delivery/worker";

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);
const clock = new SystemClock();
const ids = new UuidGenerator();
const registry = new GatewayRegistry();
registry.register(new MockGatewayAdapter());
const gatewayService = new GatewayService({ db, clock, ids, config, registry, vault: new CredentialVault(config.gatewayEncryptionKey) });
const worker = new DeliveryWorker({ db, clock, ids, gatewayService, workerId: `worker-${process.pid}` });
let stopping = false;

const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  worker.shutdown();
  console.info(JSON.stringify({ event: "worker_stopping", signal }));
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

console.info(JSON.stringify({ event: "worker_started", workerId: `worker-${process.pid}` }));

while (!stopping) {
  try {
    const result = await worker.tick();
    if (result.claimed > 0) console.info(JSON.stringify({ event: "worker_tick", workerId: `worker-${process.pid}`, ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: "worker_tick_failed", workerId: `worker-${process.pid}`, error: error instanceof Error ? error.message : "unknown" }));
  }
  await Bun.sleep(1000);
}

db.close();
console.info(JSON.stringify({ event: "worker_stopped" }));

export {};
