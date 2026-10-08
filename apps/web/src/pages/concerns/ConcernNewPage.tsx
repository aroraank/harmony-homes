import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { uploadFile } from '@/lib/files';
import { nudgePush } from '@/lib/push';
import { useOnline } from '@/lib/online';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { FileInput } from '@/components/FileInput';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/alert';
import { CATEGORY_TEXT, CONCERN_CATEGORIES } from './shared';

export default function ConcernNewPage() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [hideName, setHideName] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (title.trim().length < 3) er.title = t('Title must be 3–120 characters.');
    if (!category) er.category = t('Choose a category');
    if (!body.trim()) er.body = t('Describe the concern');
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const path = file ? await uploadFile(m.societyId, 'concerns', `new-${m.userId}`, file) : null;
      const id = await rpc<string>('raise_concern', {
        p_society: m.societyId,
        p_title: title,
        p_category: category,
        p_body: body,
        p_priority: urgent ? 'urgent' : 'normal',
        p_attachment_path: path,
        p_hide_name: hideName,
      });
      nudgePush();
      void qc.invalidateQueries({ queryKey: ['concerns'] });
      toast.success(t('Concern sent to the committee'));
      nav(`/concerns/${id}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Raise a concern')} back="/concerns" />
      <Alert variant="info" className="mb-3">
        <Lock />
        {t('Only you, the admins and the super admin can see this. Other residents never see it — not even that it exists.')}
      </Alert>
      <form onSubmit={submit} noValidate>
        <Card className="space-y-4 p-4">
          <Field label={t('Category')} error={errors.category}>
            <div className="flex flex-wrap gap-2">
              {CONCERN_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  className={cn(
                    'min-h-10 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
                    category === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >
                  {t(CATEGORY_TEXT[c] ?? c)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('Title')} error={errors.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t('e.g. Main gate light not working')} />
          </Field>
          <Field label={t('Details')} error={errors.body}>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </Field>
          <Field label={t('Photo or PDF')} optional>
            <FileInput value={file} onChange={setFile} />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">{t('Urgent')}</span>
              <span className="block text-[12.5px] text-muted-foreground">{t('Use for safety, water or power emergencies')}</span>
            </span>
            <Switch checked={urgent} onCheckedChange={setUrgent} />
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox checked={hideName} onCheckedChange={(v) => setHideName(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">{t('Hide my name from other admins')}</span>
              <span className="block text-[12.5px] text-muted-foreground">{t('The super admin can always see who raised it.')}</span>
            </span>
          </label>
        </Card>
        <Button type="submit" size="xl" variant="hero" className="mt-4 w-full" loading={busy} disabled={!online}>
          <Send /> {t('Send to committee')}
        </Button>
      </form>
    </div>
  );
}
