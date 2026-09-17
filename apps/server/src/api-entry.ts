import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { migrate } from "./db/migrate";

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);

const server = Bun.serve({
  fetch: createApp({ db, config }).fetch,
  hostname: config.apiHost,
  port: config.apiPort,
});

console.info(
  JSON.stringify({
    event: "api_started",
    host: server.hostname,
    port: server.port,
  }),
);
