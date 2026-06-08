#!/usr/bin/env bun
import { execSync } from "child_process";
import { rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

rmSync(join(root, "dist"), { recursive: true, force: true });
run("bunx tsc --noEmit");

// Self-contained CLI binary (bun runtime baked in). Names match install.sh's uname mapping.
const RELEASE_TARGETS = {
  "tasks-darwin-arm64": "bun-darwin-arm64",
  "tasks-darwin-x64": "bun-darwin-x64",
  "tasks-linux-x64": "bun-linux-x64",
  "tasks-linux-arm64": "bun-linux-arm64",
};

if (process.env.AGENT_TASKS_RELEASE === "1") {
  for (const [name, target] of Object.entries(RELEASE_TARGETS)) {
    run(`bun build --compile --target=${target} src/cli.ts --outfile dist/${name}`);
  }
} else {
  run("bun build --compile src/cli.ts --outfile dist/tasks");
}
