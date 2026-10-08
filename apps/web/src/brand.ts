/**
 * Harmony Homes brand — the single source for name, colours and logo.
 * Reuse this file in the future Android/iOS app so the product looks identical everywhere.
 */
export const brand = {
  name: 'Harmony Homes',
  shortName: 'Harmony',
  tagline: 'Transparent society funds, simply managed.',
  receiptPrefix: 'HH',
  colors: {
    primary: '#059669', // emerald 600
    primaryDark: '#047857',
    deep: '#064E3B',
    teal: '#0F766E',
    lime: '#BEF264',
    credit: '#047857',
    debit: '#BE123C',
    background: '#F3FAF6',
  },
  logo: '/icons/logo.svg',
  icon192: '/icons/icon-192.png',
  supportNote: 'Questions? Raise a concern from the app — only the committee can see it.',
} as const;

export type Brand = typeof brand;
