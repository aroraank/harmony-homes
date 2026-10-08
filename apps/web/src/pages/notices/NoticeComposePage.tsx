import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useUnitTypes, useUnits } from '@/lib/queries';
import { uploadFile } from '@/lib/files';
import { nudgePush } from '@/lib/push';
import { useOnline } from '@/lib/online';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { FileInput } from '@/components/FileInput';
import { RichText } from '@/components/RichText';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type Audience = 'all' | 'unit_types' | 'units';

export default function NoticeComposePage() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const types = useUnitTypes(m.societyId);
  const units = useUnits(m.societyId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [requireAck, setRequireAck] = useState(true);
  const [audience, setAudience] = useState<Audience>('all');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  if (!m.can('send_notices')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3 || title.trim().length > 120) e.title = t('Title must be 3–120 characters.');
    if (!body.trim() || body.length > 5000) e.body = t('Message must be 1–5000 characters.');
    if (audience === 'unit_types' && !typeIds.length) e.audience = t('Pick at least one flat type.');
    if (audience === 'units' && !unitIds.length) e.audience = t('Pick at least one flat.');
    setErrors(e);
    return !Object.keys(e).length;
  };

  const send = async () => {
    setBusy(true);
    try {
      const path = file ? await uploadFile(m.societyId, 'notices', 'files', file) : null;
      const id = await rpc<string>('send_notice', {
        p_society: m.societyId,
        p_title: title,
        p_body: body,
        p_priority: important ? 'important' : 'normal',
        p_attachment_path: path,
        p_audience_type: audience,
        p_unit_type_ids: audience === 'unit_types' ? typeIds : null,
        p_unit_ids: audience === 'units' ? unitIds : null,
        p_require_ack: requireAck,
      });
      nudgePush();
      void qc.invalidateQueries({ queryKey: ['notices'] });
      toast.success(t('Notice sent'));
      nav(`/notices/${id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const audienceLabel =
    audience === 'all'
      ? t('Everyone')
      : audience === 'unit_types'
        ? (types.data ?? []).filter((x) => typeIds.includes(x.id)).map((x) => x.name).join(', ')
        : t('{{n}} flats', { n: unitIds.length });

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('New notice')} back="/notices" />
      <Card className="space-y-4 p-4">
        <Field label={t('Title')} error={errors.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('e.g. Water supply off on Sunday')} />
        </Field>
        <Field label={t('Message')} error={errors.body} hint={t('Tip: **bold**, _italic_, and lines starting with "- " become bullets. Links work.')}>
          <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
        </Field>
        {body && (
          <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)}>
            {preview ? t('Hide preview') : t('Show preview')}
          </Button>
        )}
        {preview && body && (
          <div className="rounded-2xl border bg-muted/40 p-3 text-[15px]">
            <RichText text={body} />
          </div>
        )}
        <Field label={t('Attachment')} optional>
          <FileInput value={file} onChange={setFile} />
        </Field>
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">{t('Mark as important')}</span>
            <span className="block text-[12.5px] text-muted-foreground">{t('Shown with a red badge')}</span>
          </span>
          <Switch checked={important} onCheckedChange={setImportant} />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">{t('Require acknowledgement')}</span>
            <span className="block text-[12.5px] text-muted-foreground">{t('Members must tap "I have read this" before using the app')}</span>
          </span>
          <Switch checked={requireAck} onCheckedChange={setRequireAck} />
        </label>
      </Card>

      <Card className="mt-3 space-y-3 p-4">
        <p className="text-sm font-semibold">{t('Send to')}</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['all', t('Everyone')],
              ['unit_types', t('Flat types')],
              ['units', t('Pick flats')],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setAudience(k)}
              className={cn('min-h-11 cursor-pointer rounded-xl border px-2 text-[13px] font-semibold', audience === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-secondary')}
            >
              {label}
            </button>
          ))}
        </div>
        {audience === 'unit_types' && (
          <div className="flex flex-wrap gap-2">
            {types.data?.map((ty) => (
              <label key={ty.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3">
                <Checkbox checked={typeIds.includes(ty.id)} onCheckedChange={() => setTypeIds((l) => toggle(l, ty.id))} />
                <span className="text-sm font-semibold">{ty.name}</span>
              </label>
            ))}
          </div>
        )}
        {audience === 'units' && (
          <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto">
            {units.data?.map((u) => (
              <label key={u.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-2">
                <Checkbox checked={unitIds.includes(u.id)} onCheckedChange={() => setUnitIds((l) => toggle(l, u.id))} />
                <span className="tabular text-[13px] font-semibold">{u.code}</span>
              </label>
            ))}
          </div>
        )}
        {errors.audience && <p className="text-[13px] font-medium text-destructive">{errors.audience}</p>}
      </Card>

      <Button size="xl" variant="hero" className="mt-4 w-full" disabled={!online} onClick={() => validate() && setConfirm(true)}>
        <Send /> {t('Review and send')}
      </Button>

      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Send this notice?')}
        description={t('It is pushed to every device of the audience. Notices are never deleted — only archived.')}
        rows={[
          { label: t('Title'), value: title },
          { label: t('Send to'), value: audienceLabel },
          { label: t('Acknowledgement'), value: requireAck ? t('Required') : t('Not required') },
          { label: t('Priority'), value: important ? t('Important') : t('Normal') },
        ]}
        confirmLabel={t('Send notice')}
        loading={busy}
        onConfirm={send}
      />
    </div>
  );
}
