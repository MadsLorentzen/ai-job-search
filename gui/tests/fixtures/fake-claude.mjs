#!/usr/bin/env node
process.stdout.write("FAKE-CLAUDE-READY\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  process.stdout.write(chunk);
});
process.on("SIGWINCH", () => {
  process.stdout.write(`RESIZE ${process.stdout.columns}x${process.stdout.rows}\n`);
});
