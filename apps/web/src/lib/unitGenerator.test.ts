import { describe, expect, it } from 'vitest';
import { generateUnits, parseList } from './unitGenerator';

describe('unit generator', () => {
  it('parses lists and ranges', () => {
    expect(parseList('1-6, 9-12')).toEqual(['1', '2', '3', '4', '5', '6', '9', '10', '11', '12']);
    expect(parseList('A-C')).toEqual(['A', 'B', 'C']);
    expect(parseList('GF,FF,SF')).toEqual(['GF', 'FF', 'SF']);
  });

  it('reproduces the plot colony layout (30 units)', () => {
    const u = generateUnits({
      blocks: '1-6, 9-12',
      floors: 'GF,FF,SF',
      perFloor: 1,
      codePattern: 'P{B}-{F}',
      namePattern: 'Plot {B}, {FN}',
      blockNamePattern: 'Plot {B}',
      unitTypeId: 't',
    });
    expect(u).toHaveLength(30);
    expect(u[0]).toMatchObject({ code: 'P1-GF', display_name: 'Plot 1, Ground Floor', block_name: 'Plot 1', floor_name: 'Ground Floor' });
    expect(u.at(-1)?.code).toBe('P12-SF');
  });

  it('builds tower layouts like A-1804', () => {
    const u = generateUnits({
      blocks: 'A',
      floors: '1-18',
      perFloor: 10,
      codePattern: '{B}-{F}{N}',
      namePattern: 'Block {B}, Flat {F}{N}',
      blockNamePattern: 'Block {B}',
      unitTypeId: 't',
    });
    expect(u).toHaveLength(180);
    expect(u.find((x) => x.code === 'A-1804')?.display_name).toBe('Block A, Flat 1804');
  });
});
