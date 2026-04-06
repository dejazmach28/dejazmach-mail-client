const fs = require("node:fs");
const path = require("node:path");

const runtimeDir = path.join(process.cwd(), "dist-electron", "electron");
fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(
  path.join(runtimeDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8"
);
