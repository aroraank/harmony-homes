import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Calculator, CalendarHeart } from 'lucide-react';
import { toast } from 'sonner';
import {
  addDays,
  formatDate,
  formatINR,
  istToday,
  paiseToInput,
  parseRupeesToPaise,
  summariseEventSplit,
} from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { invalidateMoney, useSettings, useUnitTypes, useUnits } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { AmountInput } from '@/components/AmountInput';
import { Input, Textarea } from '@/components/ui/input';

type Scope = 'all' | 'unit_types' | 'custom';

export default function EventCreatePage() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const units = useUnits(m.societyId);
  const types = useUnitTypes(m.societyId);
  const settings = useSettings(m.societyId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [scope, setScope] = useState<Scope>('unit_types');
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState(addDays(istToday(), 15));
  const [rounding, setRounding] = useState('');
  const [confirm, setConfirm] = useState<null | 'open' | 'draft'>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings.data && !rounding) setRounding(paiseToInput(settings.data.share_rounding_paise));
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = useMemo(() => {
    const all = units.data ?? [];
    if (scope === 'all') return all.filter((u) => u.is_billable);
    if (scope === 'unit_types') return all.filter((u) => u.is_billable && typeIds.includes(u.unit_type_id));
    return all.filter((u) => customIds.includes(u.id));
  }, [units.data, scope, typeIds, customIds]);

  // drop exclusions that fell out of scope
  useEffect(() => {
    setExcluded((ex) =>
      Object.fromEntries(Object.entries(ex).filter(([id]) => inScope.some((u) => u.id === id))),
    );
  }, [inScope]);

  const totalPaise = parseRupeesToPaise(total) ?? 0;
  const roundingPaise = parseRupeesToPaise(rounding) ?? 100;
  const split = summariseEventSplit(totalPaise, inScope.length, Object.keys(excluded).length, roundingPaise);

  if (!m.can('manage_events')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = t('Title must be at least 3 characters.');
    if (!totalPaise) e.total = t('Enter the total estimated cost');
    if (!inScope.length) e.scope = t('No flats are in scope.');
    if (split.expected < 1) e.scope = t('At least one flat must be expected to pay.');
    if (Object.values(excluded).some((r) => r.trim().length < 2))
      e.excluded = t('Give a reason for every excluded flat.');
    if (!dueDate || dueDate < istToday()) e.due = t('Choose a due date from today onwards.');
    if (roundingPaise < 100 || roundingPaise > 1_000_000)
      e.rounding = t('Rounding must be between ₹1 and ₹10,000.');
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (open: boolean) => {
    setSaving(true);
    try {
      const id = await rpc<string>('create_event', {
        p_society: m.societyId,
        p_title: title,
        p_description: description || null,
        p_total_cost_paise: totalPaise,
        p_scope_type: scope,
        p_unit_type_ids: scope === 'unit_types' ? typeIds : [],
        p_unit_ids: scope === 'custom' ? customIds : [],
        p_excluded: Object.entries(excluded).map(([unit_id, reason]) => ({ unit_id, reason })),
        p_due_date: dueDate,
        p_rounding_paise: roundingPaise,
        p_open: open,
      });
      invalidateMoney(qc);
      nudgePush();
      toast.success(open ? t('Event opened and dues created') : t('Draft saved'));
      nav(`/events/${id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('New event')} subtitle={t('Split a special expense among flats')} back="/events" />
      <Card className="space-y-4 p-4">
        <Field label={t('Title')} error={errors.title}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t('e.g. Motor repair — 3BHK')}
          />
        </Field>
        <Field label={t('Description')} optional>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </Field>
        <Field label={t('Total estimated cost')} error={errors.total}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
              ₹
            </span>
            <AmountInput
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="tabular pl-8 text-xl font-bold"
              placeholder="240000"
            />
          </div>
        </Field>
      </Card>

      <SectionTitle>{t('Who pays?')}</SectionTitle>
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
                scope === k
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {scope === 'unit_types' && (
          <div className="flex flex-wrap gap-2">
            {types.data?.map((ty) => (
              <label
                key={ty.id}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3"
              >
                <Checkbox
                  checked={typeIds.includes(ty.id)}
                  onCheckedChange={() => setTypeIds((l) => toggle(l, ty.id))}
                />
                <span className="text-sm font-semibold">{ty.name}</span>
              </label>
            ))}
          </div>
        )}
        {errors.scope && <p className="text-[13px] font-medium text-destructive">{errors.scope}</p>}
      </Card>

      <SectionTitle>{scope === 'custom' ? t('Choose flats') : t('Expected payers')}</SectionTitle>
      <p className="-mt-1 mb-2 px-1 text-[12.5px] text-muted-foreground">
        {scope === 'custom'
          ? t('Tick the flats that share this cost.')
          : t('Untick flats not expected to pay and give a reason.')}
      </p>
      <Card className="divide-y">
        {(scope === 'custom' ? (units.data ?? []) : inScope).map((u) => {
          const isIn = scope === 'custom' ? customIds.includes(u.id) : true;
          const isExcluded = u.id in excluded;
          return (
            <div key={u.id} className="px-4 py-2.5">
              <label className="flex min-h-10 cursor-pointer items-center gap-3">
                <Checkbox
                  checked={scope === 'custom' ? isIn && !isExcluded : !isExcluded}
                  onCheckedChange={() => {
                    if (scope === 'custom' && !isIn) return setCustomIds((l) => [...l, u.id]);
                    if (scope === 'custom' && isIn && !isExcluded)
                      return setCustomIds((l) => l.filter((x) => x !== u.id));
                    setExcluded((ex) => {
                      const n = { ...ex };
                      if (isExcluded) delete n[u.id];
                      else n[u.id] = '';
                      return n;
                    });
                  }}
                />
                <span className="tabular w-16 text-sm font-bold">{u.code}</span>
                <span className="break-words text-[13px] text-muted-foreground">{u.display_name}</span>
              </label>
              {isExcluded && (
                <Input
                  className="mt-2 h-10 text-sm"
                  placeholder={t('Reason, e.g. owner abroad')}
                  value={excluded[u.id]}
                  onChange={(e) => setExcluded((ex) => ({ ...ex, [u.id]: e.target.value }))}
                  maxLength={200}
                />
              )}
            </div>
          );
        })}
        {!inScope.length && scope !== 'custom' && (
          <p className="p-4 text-sm text-muted-foreground">{t('Pick at least one flat type.')}</p>
        )}
      </Card>
      {errors.excluded && <p className="mt-2 text-[13px] font-medium text-destructive">{errors.excluded}</p>}

      <SectionTitle>{t('Due date and rounding')}</SectionTitle>
      <Card className="grid grid-cols-2 gap-3 p-4">
        <Field label={t('Due date')} error={errors.due}>
          <Input type="date" value={dueDate} min={istToday()} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t('Round up to (₹)')} error={errors.rounding}>
          <AmountInput value={rounding} onChange={(e) => setRounding(e.target.value)} />
        </Field>
      </Card>

      <div className="sticky bottom-[84px] z-10 mt-4 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-lift backdrop-blur">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="size-4 text-primary" />
          {t('{{s}} in scope, {{e}} expected → {{a}} per flat', {
            s: split.inScope,
            e: split.expected,
            a: formatINR(split.sharePaise),
          })}
        </p>
        <p className="tabular mt-0.5 text-[12.5px] text-muted-foreground">
          {t('Collects {{c}} · rounding buffer {{b}}', {
            c: formatINR(split.collectionPaise),
            b: formatINR(split.roundingBufferPaise),
          })}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => validate() && setConfirm('draft')}>
            {t('Save draft')}
          </Button>
          <Button onClick={() => validate() && setConfirm('open')}>
            <CalendarHeart /> {t('Create & open')}
          </Button>
        </div>
      </div>

      <ConfirmSheet
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'open' ? t('Open this event?') : t('Save as draft?')}
        description={
          confirm === 'open'
            ? t('Dues are created for every expected flat and members are notified.')
            : t('Nothing is billed until you open it.')
        }
        rows={[
          { label: t('Title'), value: title },
          { label: t('Total cost'), value: formatINR(totalPaise) },
          { label: t('Expected payers'), value: `${split.expected} / ${split.inScope}` },
          { label: t('Per flat'), value: formatINR(split.sharePaise), strong: true },
          { label: t('Due'), value: formatDate(dueDate) },
        ]}
        confirmLabel={confirm === 'open' ? t('Create & open') : t('Save draft')}
        loading={saving}
        onConfirm={() => save(confirm === 'open')}
      />
    </div>
  );
}
