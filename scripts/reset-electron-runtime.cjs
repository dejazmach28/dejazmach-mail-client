const fs = require("node:fs");
const path = require("node:path");

const runtimePackagePath = path.join(process.cwd(), "dist-electron", "electron", "package.json");

if (fs.existsSync(runtimePackagePath)) {
  fs.unlinkSync(runtimePackagePath);
}
