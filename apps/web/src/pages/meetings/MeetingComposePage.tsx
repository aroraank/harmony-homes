import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, GripVertical, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { istToday } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useUnitTypes, useUnits } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import type { Meeting } from '@/types';

type Scope = 'all' | 'unit_types' | 'custom';

export default function MeetingComposePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const units = useUnits(m.societyId);
  const types = useUnitTypes(m.societyId);
  const isEdit = !!id;

  const existing = useQuery({
    queryKey: ['meeting', id],
    enabled: isEdit,
    queryFn: async () => unwrap<Meeting>(await supabase.from('v_meetings').select('*').eq('id', id!).single()),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(istToday());
  const [time, setTime] = useState('19:00');
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [agenda, setAgenda] = useState<string[]>(['']);
  const [confirm, setConfirm] = useState<null | 'draft' | 'publish'>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setTitle(e.title);
    setDescription(e.description ?? '');
    setDate(e.meeting_date);
    setTime(e.start_time.slice(0, 5));
    setLocation(e.location ?? '');
    setScope(e.scope_type);
    setTypeIds(e.scope_unit_type_ids);
    setCustomIds(e.scope_unit_ids);
    const own = e.agenda.filter((a) => !a.by);
    setAgenda(own.length ? own.map((a) => a.text) : ['']);
  }, [existing.data]);

  const toggle = (list: string[], id_: string) => (list.includes(id_) ? list.filter((x) => x !== id_) : [...list, id_]);

  const audienceOk = useMemo(() => {
    if (scope === 'all') return true;
    if (scope === 'unit_types') return typeIds.length > 0;
    return customIds.length > 0;
  }, [scope, typeIds, customIds]);

  if (!m.can('manage_meetings')) return <EmptyState title={t('You do not have permission to do this.')} />;
  if (isEdit && existing.isLoading) return <CardSkeleton className="h-96" />;
  if (isEdit && existing.error) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = t('Title must be at least 3 characters.');
    if (!date || date < istToday()) e.date = t('Choose a date from today onwards.');
    if (!audienceOk) e.scope = t('Choose who should attend.');
    setErrors(e);
    return !Object.keys(e).length;
  };

  const cleanAgenda = agenda.map((a) => a.trim()).filter(Boolean);

  const save = async (publish: boolean) => {
    setSaving(true);
    try {
      if (isEdit) {
        await rpc('update_meeting', {
          p_meeting_id: id,
          p_title: title,
          p_description: description || null,
          p_meeting_date: date,
          p_start_time: time,
          p_location: location || null,
          p_scope_type: scope,
          p_unit_type_ids: scope === 'unit_types' ? typeIds : [],
          p_unit_ids: scope === 'custom' ? customIds : [],
        });
        await rpc('set_meeting_agenda', { p_meeting_id: id, p_items: cleanAgenda });
        if (publish && existing.data?.status === 'draft') await rpc('publish_meeting', { p_meeting_id: id });
        toast.success(t('Meeting updated'));
        void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
        void qc.invalidateQueries({ queryKey: ['meeting', id] });
        void qc.invalidateQueries({ queryKey: ['nextMeeting', m.societyId] });
        nudgePush();
        nav(`/meetings/${id}`, { replace: true });
      } else {
        const newId = await rpc<string>('create_meeting', {
          p_society: m.societyId,
          p_title: title,
          p_description: description || null,
          p_meeting_date: date,
          p_start_time: time,
          p_location: location || null,
          p_scope_type: scope,
          p_unit_type_ids: scope === 'unit_types' ? typeIds : [],
          p_unit_ids: scope === 'custom' ? customIds : [],
          p_agenda: cleanAgenda,
          p_publish: publish,
        });
        void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
        void qc.invalidateQueries({ queryKey: ['nextMeeting', m.societyId] });
        nudgePush();
        toast.success(publish ? t('Meeting published') : t('Draft saved'));
        nav(`/meetings/${newId}`, { replace: true });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={isEdit ? t('Edit meeting') : t('Call a meeting')} back={isEdit ? `/meetings/${id}` : '/meetings'} />
      <Card className="space-y-4 p-4">
        <Field label={t('Title')} error={errors.title}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder={t('e.g. AGM — water tank cleaning')} />
        </Field>
        <Field label={t('Description / agenda intro')} optional>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder={t('Why this meeting is being called')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Date')} error={errors.date}>
            <Input type="date" value={date} min={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('Time')}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Location')} optional>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder={t('e.g. Clubhouse')} />
        </Field>
      </Card>

      <SectionTitle>{t('Who should attend?')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {(
            [
              ['all', t('All flats')],
              ['unit_types', t('Flat types')],
              ['custom', t('Pick flats')],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scope === k}
              onClick={() => setScope(k)}
              className={cn(
                'min-h-11 cursor-pointer rounded-xl border px-2 text-[13px] font-semibold transition-colors',
                scope === k ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === 'unit_types' && (
          <div className="flex flex-wrap gap-2">
            {types.data?.map((ty) => (
              <label key={ty.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3">
                <Checkbox checked={typeIds.includes(ty.id)} onCheckedChange={() => setTypeIds((l) => toggle(l, ty.id))} />
                <span className="text-sm font-semibold">{ty.name}</span>
              </label>
            ))}
          </div>
        )}
        {scope === 'custom' && (
          <div className="max-h-64 divide-y overflow-y-auto rounded-xl border">
            {units.data?.map((u) => (
              <label key={u.id} className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2">
                <Checkbox checked={customIds.includes(u.id)} onCheckedChange={() => setCustomIds((l) => toggle(l, u.id))} />
                <span className="tabular w-16 text-sm font-bold">{u.code}</span>
                <span className="truncate text-[13px] text-muted-foreground">{u.display_name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-[12.5px] text-muted-foreground">{t('Everyone sees the notice; it states clearly who is expected to attend.')}</p>
        {errors.scope && <p className="text-[13px] font-medium text-destructive">{errors.scope}</p>}
      </Card>

      <SectionTitle
        action={
          <Button variant="ghost" size="sm" onClick={() => setAgenda((l) => [...l, ''])}>
            <Plus /> {t('Add item')}
          </Button>
        }
      >
        {t('Agenda')}
      </SectionTitle>
      <Card className="space-y-2 p-4">
        {agenda.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={item}
              onChange={(e) => setAgenda((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={300}
              placeholder={t('e.g. Approve vendor quote')}
            />
            <Button variant="ghost" size="icon" onClick={() => setAgenda((l) => l.filter((_, j) => j !== i))} disabled={agenda.length === 1}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </Card>

      <div className="sticky bottom-[84px] z-10 mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-lift backdrop-blur">
        <Button variant="outline" onClick={() => validate() && setConfirm('draft')}>
          {t('Save draft')}
        </Button>
        <Button onClick={() => validate() && setConfirm('publish')}>
          <CalendarClock /> {isEdit && existing.data?.status === 'published' ? t('Save & notify') : t('Publish')}
        </Button>
      </div>

      <ConfirmSheet
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'publish' ? t('Publish this meeting?') : t('Save as draft?')}
        description={confirm === 'publish' ? t('Every flat sees it; those expected to attend are notified directly.') : t('Nothing is sent to members yet.')}
        confirmLabel={confirm === 'publish' ? t('Publish') : t('Save draft')}
        loading={saving}
        onConfirm={() => save(confirm === 'publish')}
      />
    </div>
  );
}
