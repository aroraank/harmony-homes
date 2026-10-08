// Generates PWA icons from public/icons/logo.svg (requires `sharp`: npm i -D sharp)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require('/opt/npm-tools/node_modules/sharp'); }
const svg = fs.readFileSync(new URL('../public/icons/logo.svg', import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
await sharp(svg).resize(180, 180).flatten({ background: '#059669' }).png().toFile(out('apple-touch-icon.png'));
// maskable: full-bleed background with the mark inside the 80% safe zone
const inner = await sharp(svg).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#059669' } })
  .composite([{ input: inner, top: 76, left: 76 }]).png().toFile(out('maskable-512.png'));
console.log('icons written');
