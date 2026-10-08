/**
 * Notices and concern messages are stored as plain text (all HTML is stripped server-side).
 * This tiny formatter supports **bold**, _italic_, "- " bullet lists and links, producing safe tokens
 * that the UI renders as React elements — never as raw HTML.
 */
export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'link'; value: string; href: string };

export type BlockToken = { type: 'paragraph'; inline: InlineToken[] } | { type: 'list'; items: InlineToken[][] };

const INLINE_RE = /(\*\*[^*\n]+\*\*)|(_[^_\n]+_)|(https?:\/\/[^\s<>"']+)/g;

export function parseInline(line: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: 'text', value: line.slice(last, idx) });
    const tok = m[0];
    if (m[1]) out.push({ type: 'bold', value: tok.slice(2, -2) });
    else if (m[2]) out.push({ type: 'italic', value: tok.slice(1, -1) });
    else {
      const href = tok.replace(/[.,;:!?)]+$/, '');
      out.push({ type: 'link', value: href, href });
      if (href.length < tok.length) out.push({ type: 'text', value: tok.slice(href.length) });
    }
    last = idx + tok.length;
  }
  if (last < line.length) out.push({ type: 'text', value: line.slice(last) });
  return out;
}

export function parseRichText(body: string): BlockToken[] {
  const blocks: BlockToken[] = [];
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', inline: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list.map(parseInline) });
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1] ?? '');
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Strip formatting markers for previews / push bodies */
export function plainPreview(body: string, max = 140): string {
  const s = (body ?? '').replace(/\*\*|__?/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
