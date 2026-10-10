/**
 * Minimal, dependency-free ZIP builder (store/uncompressed method only — no deflate). Good enough
 * for bundling a handful of small text files for a single download; avoids pulling in a package
 * we can't install in this environment. Spec: https://en.wikipedia.org/wiki/ZIP_(file_format)
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()): { date: number; time: number } {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date, time };
}

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function buildZip(files: { name: string; content: string }[]): Blob {
  const enc = new TextEncoder();
  const { date, time } = dosDateTime();
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);

    const local = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04, // local file header signature
      20,
      0, // version needed
      0,
      0, // flags
      0,
      0, // method: store
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(dataBytes.length), // compressed size
      ...u32(dataBytes.length), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra length
    ]);
    chunks.push(local, nameBytes, dataBytes);

    const centralEntry = new Uint8Array([
      0x50,
      0x4b,
      0x01,
      0x02, // central directory header signature
      20,
      0, // version made by
      20,
      0, // version needed
      0,
      0, // flags
      0,
      0, // method: store
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(dataBytes.length),
      ...u32(dataBytes.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
      ...u16(0), // comment length
      ...u16(0), // disk number start
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(offset), // relative offset of local header
    ]);
    central.push(centralEntry, nameBytes);

    offset += local.length + nameBytes.length + dataBytes.length;
  }

  const centralSize = central.reduce((s, c) => s + (c as Uint8Array).length, 0);
  const end = new Uint8Array([
    0x50,
    0x4b,
    0x05,
    0x06, // end of central directory signature
    0,
    0, // disk number
    0,
    0, // disk with central dir
    ...u16(files.length), // entries on this disk
    ...u16(files.length), // total entries
    ...u32(centralSize),
    ...u32(offset), // offset of start of central directory
    ...u16(0), // comment length
  ]);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
