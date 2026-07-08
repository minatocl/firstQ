/**
 * Google Wallet 券面ロゴ(公開URLで参照される正方形PNG)を生成。
 * 紫紺(#262055)地に白い医療十字。660x660。依存なし(node:zlib)。
 * 出力: firstQ/pass-logo/google-logo.png
 * 使い方: node scripts/gen-google-logo.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pass-logo", "google-logo.png");
const SIZE = 660;
const BG = [38, 32, 85];
const FG = [255, 255, 255];

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) { rgba[i * 4] = BG[0]; rgba[i * 4 + 1] = BG[1]; rgba[i * 4 + 2] = BG[2]; rgba[i * 4 + 3] = 255; }
const arm = Math.round(SIZE * 0.26), span = Math.round(SIZE * 0.6), c = SIZE / 2, half = span / 2, t = arm / 2;
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  const px = x + 0.5, py = y + 0.5;
  const v = px >= c - t && px < c + t && py >= c - half && py < c + half;
  const hh = px >= c - half && px < c + half && py >= c - t && py < c + t;
  if (v || hh) { const o = (y * SIZE + x) * 4; rgba[o] = FG[0]; rgba[o + 1] = FG[1]; rgba[o + 2] = FG[2]; rgba[o + 3] = 255; }
}
await writeFile(outFile, encodePng(SIZE, SIZE, rgba));
console.log("wrote", outFile);
