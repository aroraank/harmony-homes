export type CsvValue = string | number | boolean | null | undefined;

function cell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Rupees as a plain number for spreadsheets (no ₹ or commas) */
export function rupees(paise: number | null | undefined): string {
  return ((paise ?? 0) / 100).toFixed(2);
}
