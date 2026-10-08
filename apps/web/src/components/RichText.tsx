import { parseRichText, type InlineToken } from '@harmony/shared';

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'bold') return <strong key={i}>{t.value}</strong>;
        if (t.type === 'italic') return <em key={i}>{t.value}</em>;
        if (t.type === 'link')
          return (
            <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium text-primary underline">
              {t.value}
            </a>
          );
        return <span key={i}>{t.value}</span>;
      })}
    </>
  );
}

/** Safe renderer for notices/messages: plain text with **bold**, _italic_, bullets and links. Never uses innerHTML. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseRichText(text);
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        b.type === 'paragraph' ? (
          <p key={i} className="mb-2 whitespace-pre-line leading-relaxed last:mb-0">
            <Inline tokens={b.inline} />
          </p>
        ) : (
          <ul key={i} className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline tokens={it} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
