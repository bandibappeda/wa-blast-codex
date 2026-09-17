import { createApp } from "./app";

const host = Bun.env.API_HOST ?? "127.0.0.1";
const port = Number(Bun.env.API_PORT ?? "3000");

const server = Bun.serve({
  fetch: createApp().fetch,
  hostname: host,
  port,
});

console.info(
  JSON.stringify({
    event: "api_started",
    host: server.hostname,
    port: server.port,
  }),
);
