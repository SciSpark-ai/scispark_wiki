import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Render the code-native favicon artwork, not the full logo presentation sheet.
// SVG and ICO share the same white rounded square in both tab themes.
const source = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(Buffer.from(source)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, ...images]));
