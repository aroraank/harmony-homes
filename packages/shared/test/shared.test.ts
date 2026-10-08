import { describe, expect, it } from 'vitest';
import {
  addMonths,
  amountInWords,
  buildUpiLink,
  computeEventShare,
  describeAllocation,
  formatINR,
  fyOf,
  generateTempPassword,
  mobileSchema,
  normalizeMobile,
  parseRichText,
  parseRupeesToPaise,
  passwordProblems,
  periodLabel,
  periodsBetween,
  personNameSchema,
  previewAllocation,
  summariseEventSplit,
  TEMP_PASSWORD_ALPHABET,
  unitStatusFor,
  upiIdSchema,
  upiTransactionNote,
  usernameToEmail,
  utrSchema,
  amountSchema,
} from '../src';

describe('money', () => {
  it('formats INR the Indian way', () => {
    expect(formatINR(24000000)).toBe('₹2,40,000');
    expect(formatINR(80000)).toBe('₹800');
    expect(formatINR(80050)).toBe('₹800.50');
    expect(formatINR(-150000, { sign: true })).toBe('−₹1,500');
    expect(formatINR(150000, { sign: true })).toBe('+₹1,500');
    expect(formatINR(1000000000)).toBe('₹1,00,00,000');
  });

  it('parses rupee input into integer paise', () => {
    expect(parseRupeesToPaise('800')).toBe(80000);
    expect(parseRupeesToPaise('2,40,000')).toBe(24000000);
    expect(parseRupeesToPaise('₹ 800.5')).toBe(80050);
    expect(parseRupeesToPaise('800.55')).toBe(80055);
    expect(parseRupeesToPaise('800.555')).toBeNull();
    expect(parseRupeesToPaise('-5')).toBeNull();
    expect(parseRupeesToPaise('0')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    // 0.1 + 0.2 style float traps must not leak in
    expect(parseRupeesToPaise('0.29')).toBe(29);
    expect(parseRupeesToPaise('1.10')).toBe(110);
  });

  it('amount schema enforces the ₹1 crore cap', () => {
    expect(amountSchema.safeParse('10000000').success).toBe(true);
    expect(amountSchema.safeParse('10000000.01').success).toBe(false);
  });

  it('writes amounts in words (Indian system)', () => {
    expect(amountInWords(24000000)).toBe('Rupees Two Lakh Forty Thousand Only');
    expect(amountInWords(80000)).toBe('Rupees Eight Hundred Only');
    expect(amountInWords(1500000)).toBe('Rupees Fifteen Thousand Only');
    expect(amountInWords(1000000000)).toBe('Rupees One Crore Only');
    expect(amountInWords(80050)).toBe('Rupees Eight Hundred and Fifty Paise Only');
    expect(amountInWords(12345678900)).toBe(
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only',
    );
  });
});

describe('allocation', () => {
  const dues = [
    { id: 'oct', label: 'Oct 2026', amountPaise: 80000, paidPaise: 0, dueDate: '2026-10-07' },
    { id: 'sep', label: 'Sep 2026', amountPaise: 80000, paidPaise: 0, dueDate: '2026-09-07' },
  ];

  it('settles oldest first and keeps the rest as advance', () => {
    const p = previewAllocation(dues, 180000);
    expect(p.lines.map((l) => [l.dueId, l.amountPaise])).toEqual([
      ['sep', 80000],
      ['oct', 80000],
    ]);
    expect(p.advancePaise).toBe(20000);
    expect(describeAllocation(p, formatINR)).toBe('covers Sep 2026 ₹800 + Oct 2026 ₹800, ₹200 advance');
  });

  it('handles partial payments and already-paid / waived dues', () => {
    const p = previewAllocation(
      [
        { ...dues[1]!, paidPaise: 30000 },
        { ...dues[0]!, waived: true },
        { id: 'nov', label: 'Nov 2026', amountPaise: 80000, paidPaise: 0, dueDate: '2026-11-07' },
      ],
      60000,
    );
    expect(p.lines).toEqual([
      { dueId: 'sep', label: 'Sep 2026', amountPaise: 50000, settlesFully: true },
      { dueId: 'nov', label: 'Nov 2026', amountPaise: 10000, settlesFully: false },
    ]);
    expect(p.advancePaise).toBe(0);
  });

  it('derives unit status', () => {
    expect(unitStatusFor(80000, 80000, 0, false)).toBe('paid');
    expect(unitStatusFor(80000, 80000, 100, false)).toBe('advance');
    expect(unitStatusFor(80000, 100, 0, false)).toBe('partial');
    expect(unitStatusFor(80000, 0, 0, false)).toBe('pending');
    expect(unitStatusFor(80000, 0, 0, true)).toBe('waived');
  });
});

describe('event share', () => {
  it('splits 2,40,000 across 18 in scope with 3 excluded', () => {
    const s = summariseEventSplit(24000000, 18, 3, 1000);
    expect(s).toEqual({ inScope: 18, expected: 15, sharePaise: 1600000, collectionPaise: 24000000, roundingBufferPaise: 0 });
  });
  it('rounds up to the nearest ₹10', () => {
    expect(computeEventShare(24000000, 18, 1000)).toBe(1334000); // ₹13,333.33 -> ₹13,340
    expect(summariseEventSplit(24000000, 18, 0, 1000).roundingBufferPaise).toBe(12000); // ₹120 buffer
    expect(computeEventShare(100, 3, 100)).toBe(100);
    expect(computeEventShare(100000, 0, 1000)).toBe(0);
  });
});

describe('validation', () => {
  it('validates names', () => {
    expect(personNameSchema.safeParse('Rohit Sharma').success).toBe(true);
    expect(personNameSchema.safeParse("D'Souza A.").success).toBe(true);
    expect(personNameSchema.safeParse('R').success).toBe(false);
    expect(personNameSchema.safeParse('Rohit  Sharma').success).toBe(false);
    expect(personNameSchema.safeParse('Rohit123').success).toBe(false);
    expect(personNameSchema.safeParse('<script>').success).toBe(false);
  });

  it('validates Indian mobiles', () => {
    expect(normalizeMobile('+91 98765 43210')).toBe('9876543210');
    expect(normalizeMobile('09876543210')).toBe('9876543210');
    expect(mobileSchema.safeParse('9876543210').success).toBe(true);
    expect(mobileSchema.safeParse('987654321').success).toBe(false); // 9 digits
    expect(mobileSchema.safeParse('5876543210').success).toBe(false); // starts with 5
  });

  it('validates UTR and UPI', () => {
    expect(utrSchema.parse('ab 12 34 56')).toBe('AB123456');
    expect(utrSchema.safeParse('12345').success).toBe(false);
    expect(utrSchema.safeParse('UTR-123456').success).toBe(false);
    expect(upiIdSchema.safeParse('society@okhdfcbank').success).toBe(true);
    expect(upiIdSchema.safeParse('society@ok1').success).toBe(false);
    expect(upiIdSchema.safeParse('nope').success).toBe(false);
  });

  it('password rules', () => {
    expect(passwordProblems('short', 'P1-GF')).toContain('At least 8 characters');
    expect(passwordProblems('p1-gf', 'P1-GF').length).toBeGreaterThan(0);
    expect(passwordProblems('TempPass123', 'P1-GF', 'TempPass123')).toContain(
      'Must be different from the current / temporary password',
    );
    expect(passwordProblems('my-new-pass', 'P1-GF', 'TempPass123')).toEqual([]);
  });

  it('maps usernames to synthetic emails', () => {
    expect(usernameToEmail('P1-GF', 'plot-colony')).toBe('p1-gf@plot-colony.local');
    expect(usernameToEmail('Admin@Example.com', 'x')).toBe('admin@example.com');
  });
});

describe('periods', () => {
  it('labels, adds and lists months', () => {
    expect(periodLabel('2026-10')).toBe('Oct 2026');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(periodsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('computes the Indian financial year', () => {
    expect(fyOf('2026-10-07')).toBe('2026-27');
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2027-04-01')).toBe('2027-28');
    expect(fyOf('2099-04-01')).toBe('2099-00');
  });
});

describe('UPI', () => {
  it('builds the transaction note and deep link', () => {
    expect(upiTransactionNote('P3-FF', { period: '2026-10' })).toBe('P3-FF-OCT-2026');
    expect(upiTransactionNote('P3-FF', { eventTitle: 'Motor repair — 3BHK' })).toBe('P3-FF-MOTOR-REPAIR-3BH');
    const link = buildUpiLink({ upiId: 'soc@okhdfc', payeeName: 'Plot Colony', amountPaise: 80000, note: 'P3-FF-OCT-2026' });
    expect(link).toBe('upi://pay?pa=soc@okhdfc&pn=Plot%20Colony&am=800.00&cu=INR&tn=P3-FF-OCT-2026');
  });
});

describe('temporary passwords', () => {
  it('are long, unique and avoid look-alike characters', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(12);
      for (const ch of p) expect(TEMP_PASSWORD_ALPHABET).toContain(ch);
      expect(p).not.toMatch(/[0O1lI5S2Z8B]/);
      seen.add(p);
    }
    expect(seen.size).toBe(500);
    expect(() => generateTempPassword(8)).toThrow();
  });
});

describe('rich text', () => {
  it('parses bold, lists and links without HTML', () => {
    const b = parseRichText('Water **off** Sunday\n\n- Fill tanks\n- See https://example.com.');
    expect(b[0]).toEqual({
      type: 'paragraph',
      inline: [
        { type: 'text', value: 'Water ' },
        { type: 'bold', value: 'off' },
        { type: 'text', value: ' Sunday' },
      ],
    });
    expect(b[1]?.type).toBe('list');
    const items = (b[1] as { type: 'list'; items: unknown[][] }).items;
    expect(items[1]).toContainEqual({ type: 'link', value: 'https://example.com', href: 'https://example.com' });
  });
});
