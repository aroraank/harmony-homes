import { amountInWords, formatDate, formatDateTime } from '@harmony/shared';
import { brand } from '@/brand';

// jsPDF's built-in fonts cannot draw "₹", so PDFs use "Rs." (amount in words is always included).
export function pdfINR(paise: number): string {
  const abs = Math.abs(paise);
  const body = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: abs % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs / 100);
  return `${paise < 0 ? '-' : ''}Rs. ${body}`;
}

async function loadJsPdf() {
  const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable: autoTable.default };
}

async function logoPng(): Promise<string | null> {
  try {
    const res = await fetch(brand.icon192);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface ReceiptData {
  societyName: string;
  receiptNo: string;
  date: string;
  unitCode: string;
  memberName: string | null;
  amountPaise: number;
  covers: { label: string; amount_paise: number }[];
  mode: string;
  reference: string | null;
  recordedBy: string | null;
  postedAt: string;
  verifyUrl: string;
  token: string;
  cancelled: boolean;
  cancelReason: string | null;
}

export async function receiptPdf(r: ReceiptData): Promise<Blob> {
  const { jsPDF } = await loadJsPdf();
  const QR = await import('qrcode');
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // header band
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(4, 120, 87);
  doc.rect(0, 26, W, 4, 'F');
  const logo = await logoPng();
  if (logo) doc.addImage(logo, 'PNG', 10, 7, 16, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(brand.name, 30, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(r.societyName, 30, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PAYMENT RECEIPT', W - 10, 14, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(r.receiptNo, W - 10, 20, { align: 'right' });

  doc.setTextColor(20, 30, 28);
  let y = 42;
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 110);
    doc.text(label, 12, y);
    doc.setTextColor(20, 30, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(value, W - 70);
    doc.text(lines, 55, y);
    y += 6.5 * Math.max(1, lines.length);
  };
  row('Receipt no.', r.receiptNo);
  row('Date', formatDate(r.date));
  row('Flat', r.unitCode);
  if (r.memberName) row('Received from', r.memberName);
  row('Mode', r.mode);
  if (r.reference) row('UTR / reference', r.reference);
  if (r.covers.length)
    row('Towards', r.covers.map((c) => `${c.label} (${pdfINR(c.amount_paise)})`).join(', '));
  if (r.recordedBy) row('Recorded / approved by', r.recordedBy);

  // amount box
  y += 2;
  doc.setDrawColor(5, 150, 105);
  doc.setFillColor(236, 253, 245);
  doc.roundedRect(10, y, W - 20, 24, 3, 3, 'FD');
  doc.setTextColor(4, 120, 87);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(pdfINR(r.amountPaise), 15, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(20, 30, 28);
  doc.text(doc.splitTextToSize(amountInWords(r.amountPaise), W - 30), 15, y + 17);
  y += 32;

  // verification QR
  const qr = await QR.toDataURL(r.verifyUrl, {
    margin: 1,
    width: 240,
    color: { dark: '#064E3B', light: '#FFFFFF' },
  });
  doc.addImage(qr, 'PNG', 12, y, 26, 26);
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 110);
  doc.text('Scan to verify this receipt', 42, y + 8);
  doc.setTextColor(20, 30, 28);
  doc.setFont('courier', 'bold');
  doc.text(`Code: ${r.token}`, 42, y + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 110);
  doc.text(doc.splitTextToSize(r.verifyUrl, W - 55), 42, y + 20);

  doc.setFontSize(7.5);
  doc.text(
    `Issued only after the society verified the payment. Posted ${formatDateTime(r.postedAt)} IST. Computer-generated; no signature required.`,
    W / 2,
    H - 10,
    { align: 'center', maxWidth: W - 20 },
  );

  if (r.cancelled) {
    doc.setTextColor(190, 18, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(46);
    doc.text('CANCELLED', W / 2, H / 2 + 10, { align: 'center', angle: 30 });
    if (r.cancelReason) {
      doc.setFontSize(10);
      doc.text(doc.splitTextToSize(`Reason: ${r.cancelReason}`, W - 30), W / 2, H / 2 + 30, {
        align: 'center',
      });
    }
  }
  return doc.output('blob');
}

export interface ReportSection {
  title: string;
  summary?: [string, string][];
  table?: { head: string[]; body: (string | number)[][] };
  note?: string;
}

/** Generic A4 report: header + sections of key/value summaries and tables */
export async function reportPdf(
  title: string,
  societyName: string,
  sections: ReportSection[],
): Promise<Blob> {
  const { jsPDF, autoTable } = await loadJsPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, W, 24, 'F');
  const logo = await logoPng();
  if (logo) doc.addImage(logo, 'PNG', 10, 5, 14, 14);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(brand.name, 28, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(societyName, 28, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(title, W - 10, 14, { align: 'right' });

  let y = 32;
  for (const s of sections) {
    if (y > 260) {
      doc.addPage();
      y = 16;
    }
    doc.setTextColor(4, 120, 87);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text(s.title, 10, y);
    y += 3;
    if (s.summary?.length) {
      autoTable(doc, {
        startY: y,
        body: s.summary,
        theme: 'plain',
        styles: { fontSize: 9.5, cellPadding: 1.6 },
        columnStyles: { 0: { textColor: [90, 105, 100] }, 1: { fontStyle: 'bold', halign: 'right' } },
        margin: { left: 10, right: 10 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    }
    if (s.table && s.table.body.length) {
      autoTable(doc, {
        startY: y,
        head: [s.table.head],
        body: s.table.body,
        theme: 'striped',
        headStyles: { fillColor: [5, 150, 105], fontSize: 9 },
        styles: { fontSize: 8.8, cellPadding: 1.8 },
        margin: { left: 10, right: 10 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    }
    if (s.note) {
      doc.setTextColor(60, 70, 66);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(s.note, W - 20);
      doc.text(lines, 10, y + 2);
      y += 5 * lines.length + 2;
    }
    y += 4;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120, 130, 126);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Generated ${formatDateTime(new Date().toISOString())} IST · Page ${i} of ${pages}`,
      W / 2,
      290,
      { align: 'center' },
    );
  }
  return doc.output('blob');
}

/** Share a PDF via the native share sheet (WhatsApp etc.), falling back to download */
export async function shareOrDownloadPdf(blob: Blob, filename: string, text?: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const { downloadBlob } = await import('./csv');
  downloadBlob(filename, blob);
}

export interface StatementLine {
  date: string;
  /** flat code that paid / was charged; when any line has one the statement gets a Flat column */
  flat?: string;
  description: string;
  ref: string;
  /** first / second amount column (paise) */
  a: number;
  b: number;
  /** change of the running balance caused by this line (paise) */
  delta: number;
  /** true when this payment, though dated in this period, actually settles an earlier due (a catch-up payment) — shown with a highlighted background */
  highlight?: boolean;
}

/**
 * Accountant-style statement: opening balance, every line with a running balance, totals and closing balance.
 * `balanceMode` 'cash' prints the balance as it is; 'owed' prints Dr (flat owes) / Cr (flat is ahead).
 */
export async function statementPdf(o: {
  title: string;
  societyName: string;
  subject: string;
  from: string;
  to: string;
  headA: string;
  headB: string;
  opening: number;
  lines: StatementLine[];
  balanceMode: 'cash' | 'owed';
  note?: string;
}): Promise<Blob> {
  const { jsPDF, autoTable } = await loadJsPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const num = (p: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Math.abs(p) / 100,
    );
  const bal = (p: number) =>
    o.balanceMode === 'owed' ? `${num(p)} ${p >= 0 ? 'Dr' : 'Cr'}` : `${p < 0 ? '-' : ''}${num(p)}`;

  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, W, 26, 'F');
  const logo = await logoPng();
  if (logo) doc.addImage(logo, 'PNG', 10, 6, 14, 14);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(brand.name, 28, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(o.societyName, 28, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(o.title, W - 10, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${formatDate(o.from)} to ${formatDate(o.to)}`, W - 10, 18, { align: 'right' });

  doc.setTextColor(20, 30, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(o.subject, 10, 34);

  let run = o.opening;
  const totalA = o.lines.reduce((s, l) => s + l.a, 0);
  const totalB = o.lines.reduce((s, l) => s + l.b, 0);
  const closing = o.opening + o.lines.reduce((s, l) => s + l.delta, 0);
  const withFlat = o.lines.some((l) => l.flat !== undefined);
  const row = (
    date: string,
    flat: string,
    desc: string,
    ref: string,
    a: string,
    b: string,
    bl: string,
  ): string[] => (withFlat ? [date, flat, desc, ref, a, b, bl] : [date, desc, ref, a, b, bl]);
  const body: (string | number)[][] = [row('', '', 'Opening balance', '', '', '', bal(o.opening))];
  const highlightRows = new Set<number>();
  for (const l of o.lines) {
    run += l.delta;
    if (l.highlight) highlightRows.add(body.length);
    body.push(
      row(
        formatDate(l.date),
        l.flat ?? '',
        l.description,
        l.ref,
        l.a ? num(l.a) : '',
        l.b ? num(l.b) : '',
        bal(run),
      ),
    );
  }
  body.push(row('', '', 'Total for the period', '', num(totalA), num(totalB), ''));
  body.push(row('', '', 'Closing balance', '', '', '', bal(closing)));

  autoTable(doc, {
    startY: 38,
    head: [
      withFlat
        ? [
            'Date',
            'Flat',
            'Particulars',
            'Receipt / Ref',
            `${o.headA} (Rs.)`,
            `${o.headB} (Rs.)`,
            'Balance (Rs.)',
          ]
        : ['Date', 'Particulars', 'Receipt / Ref', `${o.headA} (Rs.)`, `${o.headB} (Rs.)`, 'Balance (Rs.)'],
    ],
    body,
    theme: 'striped',
    headStyles: { fillColor: [5, 150, 105], fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
    columnStyles: withFlat
      ? {
          0: { cellWidth: 18 },
          1: { cellWidth: 26, fontStyle: 'bold' },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 24 },
          4: { halign: 'right', cellWidth: 19 },
          5: { halign: 'right', cellWidth: 19 },
          6: { halign: 'right', cellWidth: 23, fontStyle: 'bold' },
        }
      : {
          0: { cellWidth: 21 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 29 },
          3: { halign: 'right', cellWidth: 25 },
          4: { halign: 'right', cellWidth: 25 },
          5: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
        },
    margin: { left: 10, right: 10, bottom: 16 },
    didParseCell: (d) => {
      const first = d.row.index === 0;
      const last = d.row.index >= body.length - 2;
      if (d.section === 'body' && (first || last)) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fillColor = [220, 245, 235];
      } else if (d.section === 'body' && highlightRows.has(d.row.index)) {
        d.cell.styles.fillColor = [255, 240, 199];
      }
    },
  });

  const legend =
    highlightRows.size > 0
      ? 'Rows shaded amber were paid in this period but settle an earlier due (a catch-up payment for a previous month).'
      : null;
  const noteText = [o.note, legend].filter(Boolean).join(' ');
  if (noteText) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 70, 66);
    doc.text(doc.splitTextToSize(noteText, W - 20), 10, y);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120, 130, 126);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Computer-generated statement · ${formatDateTime(new Date().toISOString())} IST · Page ${i} of ${pages}`,
      W / 2,
      290,
      { align: 'center' },
    );
  }
  return doc.output('blob');
}
