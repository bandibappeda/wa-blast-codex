let stopping = false;

const shutdown = (signal: string) => {
  stopping = true;
  console.info(JSON.stringify({ event: "worker_stopping", signal }));
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

console.info(JSON.stringify({ event: "worker_started", mode: "noop" }));

while (!stopping) {
  await Bun.sleep(1000);
}

console.info(JSON.stringify({ event: "worker_stopped" }));

export {};
