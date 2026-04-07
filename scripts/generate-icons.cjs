const fs = require("node:fs");
const path = require("node:path");

const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const rootDir = process.cwd();
const iconDir = path.join(rootDir, "assets", "icons");
const svgPath = path.join(iconDir, "icon.svg");
const sizes = [16, 32, 48, 64, 128, 256, 512];

const logFileSize = (filePath) => {
  const stats = fs.statSync(filePath);
  console.log(`${path.basename(filePath)} ${stats.size}`);
};

const main = async () => {
  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = path.join(iconDir, `${size}x${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);
    logFileSize(outputPath);
  }

  const icoBuffer = await pngToIco(path.join(iconDir, "256x256.png"));
  const icoPath = path.join(iconDir, "icon.ico");
  fs.writeFileSync(icoPath, icoBuffer);
  logFileSize(icoPath);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
