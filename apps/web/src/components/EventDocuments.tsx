import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@harmony/shared';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { uploadFile, validateFile } from '@/lib/files';
import { SectionTitle } from '@/components/PageHeader';
import { AttachmentButton } from '@/components/AttachmentButton';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { FileInput } from '@/components/FileInput';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Doc = { id: string; title: string; note: string | null; file_path: string; mime_type: string | null; size_bytes: number | null; created_at: string; updated_at: string | null };
type Pick = { file: File; title: string; note: string };

const stem = (n: string) => n.replace(/\.[^.]+$/, '').slice(0, 100);

/** Estimates and other papers for an event. Everyone can open them; managers can add, edit and remove (everyone is notified). */
export function EventDocuments({ eventId, societyId, canManage }: { eventId: string; societyId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['eventDocs', eventId],
    queryFn: async () => unwrap<Doc[]>(await supabase.from('event_documents').select('*').eq('event_id', eventId).is('removed_at', null).order('created_at')),
  });
  const docs = q.data ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['eventDocs', eventId] });
    nudgePush();
  };

  const input = useRef<HTMLInputElement>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Doc | null>(null);
  const [eTitle, setETitle] = useState('');
  const [eNote, setENote] = useState('');
  const [eFile, setEFile] = useState<File | null>(null);
  const [del, setDel] = useState<Doc | null>(null);

  if (docs.length === 0 && !canManage) return null;

  const choose = (files: FileList | null) => {
    if (!files) return;
    const ok: Pick[] = [];
    for (const f of Array.from(files)) {
      const err = validateFile(f);
      if (err) toast.error(`${f.name}: ${t(err)}`);
      else ok.push({ file: f, title: stem(f.name), note: '' });
    }
    if (ok.length) setPicks((p) => [...p, ...ok].slice(0, 10));
  };

  const upload = async () => {
    if (picks.some((p) => p.title.trim().length < 2)) return toast.error(t('Give every document a name.'));
    setBusy(true);
    try {
      const rows = [];
      for (const p of picks) {
        const path = await uploadFile(societyId, 'events', eventId, p.file);
        rows.push({ title: p.title.trim(), note: p.note.trim() || null, path, mime: p.file.type, size: p.file.size });
      }
      await rpc('add_event_documents', { p_event_id: eventId, p_docs: rows });
      toast.success(t('Added. Everyone has been notified.'));
      setPicks([]);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (eTitle.trim().length < 2) return toast.error(t('Give the document a name.'));
    setBusy(true);
    try {
      const path = eFile ? await uploadFile(societyId, 'events', eventId, eFile) : null;
      await rpc('update_event_document', { p_doc_id: edit.id, p_title: eTitle, p_note: eNote || null, p_file_path: path, p_mime: eFile?.type ?? null, p_size: eFile?.size ?? null });
      toast.success(t('Saved. Everyone has been notified.'));
      setEdit(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await rpc('remove_event_document', { p_doc_id: del.id });
      toast.success(t('Removed. Everyone has been notified.'));
      setDel(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle
        action={
          canManage ? (
            <Button variant="link" size="sm" onClick={() => input.current?.click()}>
              <Plus /> {t('Add documents')}
            </Button>
          ) : undefined
        }
      >
        {t('Documents & estimates')}
      </SectionTitle>
      <input ref={input} type="file" multiple className="sr-only" accept="image/*,application/pdf" onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
      {docs.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('No documents yet. Add the estimate PDFs or photos here.')}</p>
      ) : (
        <Card className="divide-y">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              {d.mime_type?.startsWith('image/') ? <ImageIcon className="size-5 shrink-0 text-primary" /> : <FileText className="size-5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.title}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {formatDate((d.updated_at ?? d.created_at).slice(0, 10))}
                  {d.updated_at ? ` · ${t('edited')}` : ''}
                  {d.note ? ` · ${d.note}` : ''}
                </p>
              </div>
              <AttachmentButton path={d.file_path} label={t('View')} />
              {canManage && (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label={t('Edit')} onClick={() => { setEdit(d); setETitle(d.title); setENote(d.note ?? ''); setEFile(null); }}>
                    <Pencil />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t('Remove')} onClick={() => setDel(d)}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <Dialog open={picks.length > 0} onOpenChange={(o) => !o && !busy && setPicks([])}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Add documents')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55dvh] space-y-3 overflow-y-auto">
            {picks.map((p, i) => (
              <div key={i} className="space-y-2 rounded-2xl border p-3">
                <Field label={t('Name')}>
                  <Input value={p.title} maxLength={120} onChange={(e) => setPicks((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                </Field>
                <Field label={t('Note')} optional>
                  <Input value={p.note} maxLength={500} placeholder={t('e.g. Estimate from Sharma Motors')} onChange={(e) => setPicks((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                </Field>
                <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                  <span className="truncate">{p.file.name}</span>
                  <button type="button" className="cursor-pointer font-semibold text-destructive" onClick={() => setPicks((l) => l.filter((_, j) => j !== i))}>
                    {t('Remove file')}
                  </button>
                </div>
              </div>
            ))}
            {picks.length < 10 && (
              <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
                <Plus /> {t('Add another')}
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicks([])} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button onClick={upload} loading={busy}>
              {t('Upload and notify everyone')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!edit} onOpenChange={(o) => !o && !busy && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Edit document')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('Name')}>
              <Input value={eTitle} maxLength={120} onChange={(e) => setETitle(e.target.value)} />
            </Field>
            <Field label={t('Note')} optional>
              <Input value={eNote} maxLength={500} onChange={(e) => setENote(e.target.value)} />
            </Field>
            <FileInput value={eFile} onChange={setEFile} label={t('Replace the file (optional)')} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button onClick={saveEdit} loading={busy}>
              {t('Save and notify everyone')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmSheet
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={t('Remove “{{n}}”?', { n: del?.title ?? '' })}
        description={t('Members will no longer see it and everyone is notified. The file is kept in the audit trail.')}
        confirmLabel={t('Remove')}
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
