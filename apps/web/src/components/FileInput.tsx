import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, ImagePlus, X } from 'lucide-react';
import { validateFile } from '@/lib/files';
import { cn } from '@/lib/utils';

/** Pick a photo/PDF (camera on phones). The parent uploads it on submit. */
export function FileInput({
  value,
  onChange,
  label,
  imagesOnly,
  maxBytes,
}: {
  value: File | null;
  onChange: (f: File | null) => void;
  label?: string;
  imagesOnly?: boolean;
  maxBytes?: number;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (value && value.type.startsWith('image/')) {
      const u = URL.createObjectURL(value);
      setPreview(u);
      return () => URL.revokeObjectURL(u);
    }
    setPreview(null);
  }, [value]);

  return (
    <div>
      <input
        ref={ref}
        type="file"
        className="sr-only"
        accept={imagesOnly ? 'image/png,image/jpeg,image/webp' : 'image/*,application/pdf'}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (!f) return;
          const err = validateFile(f, { imagesOnly, maxBytes });
          setError(err ? t(err) : null);
          if (!err) onChange(f);
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-2.5">
          {preview ? (
            <img src={preview} alt="" className="size-14 rounded-xl object-cover" />
          ) : (
            <div className="grid size-14 place-items-center rounded-xl bg-card">
              <FileText className="size-6 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(value.size / 1024))} KB</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-card"
            aria-label={t('Remove file')}
          >
            <X className="size-5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={cn(
            'flex w-full cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-input bg-card px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-secondary/50',
          )}
        >
          <ImagePlus className="size-6 text-primary" />
          <span className="text-sm font-medium">{label ?? t('Add photo or PDF')}</span>
        </button>
      )}
      {error && <p className="mt-1.5 text-[13px] font-medium text-destructive">{error}</p>}
    </div>
  );
}
