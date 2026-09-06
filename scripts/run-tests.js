#!/usr/bin/env node
// Runs every compiled *.test.js under .test-build/test with Node's built-in
// test runner. Avoids CLI glob handling, which differs across Node versions
// (directories on 18/20, glob strings on 21+) and shells (no glob expansion
// on Windows cmd).
const { readdirSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const dir = path.join(__dirname, "..", ".test-build", "test");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error(`No test files found in ${dir}. Run 'npm run build:test' first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
