import { describe, expect, it } from 'vitest';
import { rupees, toCsv } from './csv';

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=1+1']])).toBe('a,b\r\n"x,y",\'=1+1');
    expect(toCsv(['n'], [[null], [5]])).toBe('n\r\n\r\n5');
  });
  it('formats rupees', () => {
    expect(rupees(80050)).toBe('800.50');
  });
});
