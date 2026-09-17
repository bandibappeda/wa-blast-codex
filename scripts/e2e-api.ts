import { spawn } from "node:child_process";

await import("./seed-e2e");

const child = spawn("bun", ["--filter", "@wa-blast/server", "dev:api"], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.API_PORT ?? "3100"}/api/health`);
    if (response.ok) break;
  } catch {
    await Bun.sleep(500);
  }
}

const worker = spawn("bun", ["--filter", "@wa-blast/server", "dev:worker"], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

const stop = () => {
  child.kill("SIGTERM");
  worker.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const exitCode = await new Promise<number>((resolve) => {
  child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
worker.kill("SIGTERM");
process.exit(exitCode);
