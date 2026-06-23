#!/usr/bin/env node
import { runStdio } from "./server.js";

runStdio().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
