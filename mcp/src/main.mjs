import { runServer } from "./server.mjs";

runServer().catch((error) => {
  process.stderr.write(`agent-launch MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
