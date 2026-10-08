/**
 * Bulk unit generator: blocks × floors × units-per-floor with naming patterns.
 * Tokens: {B} block label, {F} floor short label, {FN} floor long name, {N} unit number (01, 02…), {n} unit number without padding.
 */

export function parseList(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const num = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const letters = /^([A-Za-z])\s*-\s*([A-Za-z])$/.exec(part);
    if (num) {
      const a = Number(num[1]);
      const b = Number(num[2]);
      if (b - a > 500) throw new Error('Range too large');
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
    } else if (letters) {
      const a = letters[1]!.toUpperCase().charCodeAt(0);
      const b = letters[2]!.toUpperCase().charCodeAt(0);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String.fromCharCode(i));
    } else out.push(part);
  }
  return [...new Set(out)];
}

const FLOOR_NAMES: Record<string, string> = {
  LG: 'Lower Ground',
  B: 'Basement',
  G: 'Ground Floor',
  GF: 'Ground Floor',
  FF: 'First Floor',
  SF: 'Second Floor',
  TF: 'Third Floor',
};

export function floorLongName(f: string): string {
  const k = f.toUpperCase();
  if (FLOOR_NAMES[k]) return FLOOR_NAMES[k]!;
  if (/^\d+$/.test(f)) return `Floor ${Number(f)}`;
  return f;
}

export interface GeneratorInput {
  blocks: string;
  floors: string;
  perFloor: number;
  codePattern: string;
  namePattern: string;
  blockNamePattern: string;
  unitTypeId: string;
}

export interface GeneratedUnit {
  code: string;
  display_name: string;
  block_name: string | null;
  floor_name: string | null;
  floor_level: number;
  unit_type_id: string;
  sort_order: number;
}

function fill(pattern: string, b: string, f: string, n: number): string {
  return pattern
    .replace(/\{B\}/g, b)
    .replace(/\{FN\}/g, floorLongName(f))
    .replace(/\{F\}/g, f)
    .replace(/\{N\}/g, String(n).padStart(2, '0'))
    .replace(/\{n\}/g, String(n));
}

export function generateUnits(i: GeneratorInput, startSort = 0): GeneratedUnit[] {
  const blocks = i.blocks.trim() ? parseList(i.blocks) : [''];
  const floors = i.floors.trim() ? parseList(i.floors) : [''];
  const per = Math.max(1, Math.min(50, Math.trunc(i.perFloor || 1)));
  const out: GeneratedUnit[] = [];
  let sort = startSort;
  for (const b of blocks) {
    floors.forEach((f, level) => {
      for (let n = 1; n <= per; n++) {
        sort++;
        out.push({
          code: fill(i.codePattern, b, f, n).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, ''),
          display_name: fill(i.namePattern, b, f, n).replace(/\s+/g, ' ').trim(),
          block_name: b ? fill(i.blockNamePattern, b, f, n).trim() || null : null,
          floor_name: f ? floorLongName(f) : null,
          floor_level: level,
          unit_type_id: i.unitTypeId,
          sort_order: sort,
        });
      }
    });
  }
  return out;
}
