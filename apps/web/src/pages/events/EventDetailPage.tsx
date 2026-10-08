import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck2, Download, FileText, IndianRupee, Pencil, PlayCircle, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatINR, parseRupeesToPaise, summariseEventSplit } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { invalidateMoney } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { downloadCsv, rupees } from '@/lib/csv';
import { reportPdf, shareOrDownloadPdf, pdfINR } from '@/lib/pdf';
import { categoryLabel, cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { StatTile } from '@/components/StatTile';
import { StatusChip } from '@/components/StatusChip';
import { Money } from '@/components/Money';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { UnitLink } from '@/components/UnitLink';
import { AmountInput } from '@/components/AmountInput';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import type { EventReport } from '@/types';

export default function EventDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['eventReport', id], enabled: !!id, queryFn: () => rpc<EventReport>('event_report', { p_event_id: id }) });
  const [action, setAction] = useState<null | 'open' | 'delete' | 'close'>(null);
  const [settle, setSettle] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editTotal, setEditTotal] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editExcluded, setEditExcluded] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);

  if (q.isLoading) return <CardSkeleton className="h-96" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const e = r.event;
  const canManage = m.can('manage_events');
  const net = r.collected_paise - r.spent_paise;

  const run = async () => {
    setBusy(true);
    try {
      if (action === 'open') {
        await rpc('open_event', { p_event_id: e.id });
        toast.success(t('Event opened and dues created'));
      } else if (action === 'delete') {
        await rpc('delete_event_draft', { p_event_id: e.id });
        toast.success(t('Draft deleted'));
        invalidateMoney(qc);
        nav('/events', { replace: true });
        return;
      } else if (action === 'close') {
        const res = await rpc<{ balance_paise: number; moved_paise: number }>('close_event', { p_event_id: e.id, p_settle: settle, p_note: note || null });
        toast.success(
          res.moved_paise > 0
            ? t('Closed. Surplus {{a}} moved to General.', { a: formatINR(res.moved_paise) })
            : res.moved_paise < 0
              ? t('Closed. Shortfall {{a}} covered from General.', { a: formatINR(-res.moved_paise) })
              : t('Event closed'),
        );
      }
      invalidateMoney(qc);
      nudgePush();
      setAction(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    setEditTitle(e.title);
    setEditDesc(e.description ?? '');
    setEditDueDate(e.due_date);
    setEditTotal((r.target_paise / 100).toString());
    setEditReason('');
    setEditExcluded(Object.fromEntries(r.units.filter((u) => !u.expected).map((u) => [u.unit_id, u.exclusion_reason ?? ''])));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setEditBusy(true);
    try {
      if (e.status === 'draft') {
        await rpc('edit_event_draft', { p_event_id: e.id, p_title: editTitle, p_description: editDesc, p_due_date: editDueDate });
      } else {
        const paise = parseRupeesToPaise(editTotal);
        if (paise === null) throw new Error(t('Enter a valid amount'));
        if (paise <= 0) throw new Error(t('Enter a valid amount'));
        if (Object.values(editExcluded).some((x) => x.trim().length < 2)) throw new Error(t('Give a reason for every excluded flat.'));
        if (editReason.trim().length < 3) throw new Error(t('Give a short reason — flats will see it'));
        await rpc('update_event_target', {
          p_event_id: e.id,
          p_total_cost_paise: paise,
          p_excluded: Object.entries(editExcluded).map(([unit_id, reason]) => ({ unit_id, reason: reason.trim() })),
          p_reason: editReason.trim(),
        });
      }
      toast.success(t('Event updated'));
      invalidateMoney(qc);
      void qc.invalidateQueries({ queryKey: ['eventReport', id] });
      nudgePush();
      setEditOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setEditBusy(false);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      `event-${e.title.replace(/\W+/g, '-').toLowerCase()}.csv`,
      ['Flat', 'Expected', 'Reason excluded', 'Due (Rs)', 'Paid (Rs)', 'Status', 'Paid extra (Rs)'],
      r.units.map((u) => [u.unit_code, u.expected ? 'yes' : 'no', u.exclusion_reason, rupees(u.due_paise), rupees(u.paid_paise), u.status, rupees(u.extra_paise)]),
    );

  const exportPdf = async () => {
    try {
      const blob = await reportPdf(`Event: ${e.title}`, m.society_name, [
        {
          title: 'Summary',
          summary: [
            ['Target (estimated cost)', pdfINR(r.target_paise)],
            ['Per flat', `${pdfINR(e.per_unit_share_paise)} x ${e.expected_count} expected (of ${e.in_scope_count} in scope)`],
            ['Collected', pdfINR(r.collected_paise)],
            ['Spent', pdfINR(r.spent_paise)],
            ['Remaining to collect', pdfINR(r.remaining_to_collect_paise)],
            [net >= 0 ? 'Surplus' : 'Shortfall', pdfINR(Math.abs(net))],
            ['Fund balance', pdfINR(r.balance_paise)],
          ],
        },
        {
          title: 'Flats',
          table: {
            head: ['Flat', 'Due', 'Paid', 'Status'],
            body: r.units.map((u) => [u.unit_code, pdfINR(u.due_paise), pdfINR(u.paid_paise), u.expected ? u.status : `excluded: ${u.exclusion_reason ?? ''}`]),
          },
        },
        {
          title: 'Entries',
          table: {
            head: ['Date', 'Item', 'Amount'],
            body: r.entries.map((x) => [formatDate(x.date), `${x.unit_code ?? x.payee ?? ''} ${categoryLabel(x.category)}${x.is_reversed ? ' (reversed)' : ''}`, pdfINR(x.direction === 'credit' ? x.amount_paise : -x.amount_paise)]),
          },
        },
      ]);
      await shareOrDownloadPdf(blob, `event-${e.id.slice(0, 8)}.pdf`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={e.title}
        subtitle={`${t('Due {{d}}', { d: formatDate(e.due_date) })}`}
        back="/events"
        actions={
          <Badge variant={e.status === 'open' ? 'success' : e.status === 'draft' ? 'warning' : 'muted'}>
            {t(e.status === 'open' ? 'Open' : e.status === 'draft' ? 'Draft' : 'Closed')}
          </Badge>
        }
      />
      {e.description && <p className="mb-3 text-sm text-muted-foreground">{e.description}</p>}

      <Card className="mb-3 p-4">
        <p className="text-sm">
          {t('{{s}} in scope, {{e}} expected → {{a}} per flat', { s: e.in_scope_count, e: e.expected_count, a: formatINR(e.per_unit_share_paise) })}
          {e.scope_unit_type_names.length > 0 && <span className="text-muted-foreground"> · {e.scope_unit_type_names.join(', ')}</span>}
        </p>
        <p className="tabular text-[12.5px] text-muted-foreground">{t('Rounding buffer {{b}}', { b: formatINR(r.rounding_buffer_paise) })}</p>
      </Card>

      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label={t('Target')} value={formatINR(r.target_paise)} />
        <StatTile label={t('Collected')} value={formatINR(r.collected_paise)} tone="good" />
        <StatTile label={t('Spent')} value={formatINR(r.spent_paise)} tone="bad" />
        <StatTile label={t('Remaining to collect')} value={formatINR(r.remaining_to_collect_paise)} tone={r.remaining_to_collect_paise ? 'warn' : 'default'} />
        <StatTile label={net >= 0 ? t('Surplus') : t('Shortfall')} value={<Money paise={net} sign tone="auto" />} />
        <StatTile label={t('Fund balance')} value={formatINR(r.balance_paise)} />
      </div>

      {canManage && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {e.status === 'draft' && (
            <>
              <Button onClick={() => setAction('open')}>
                <PlayCircle /> {t('Open event')}
              </Button>
              <Button variant="outline" onClick={openEdit}>
                <Pencil /> {t('Edit')}
              </Button>
              <Button variant="outline" className="col-span-2" onClick={() => setAction('delete')}>
                <Trash2 /> {t('Delete draft')}
              </Button>
            </>
          )}
          {e.status === 'open' && (
            <Button variant="outline" onClick={openEdit}>
              <Pencil /> {t('Edit amount / flats')}
            </Button>
          )}
          {e.status !== 'draft' && e.fund_id && (
            <>
              {m.can('record_payment') && (
                <Button asChild variant="secondary">
                  <Link to={`/admin/payment?fund=${e.fund_id}`}>
                    <IndianRupee /> {t('Record payment')}
                  </Link>
                </Button>
              )}
              {m.can('record_expense') && (
                <Button asChild variant="secondary">
                  <Link to={`/admin/expense?fund=${e.fund_id}`}>
                    <Receipt /> {t('Record expense')}
                  </Link>
                </Button>
              )}
            </>
          )}
          {e.status === 'open' && (
            <Button variant="outline" className="col-span-2" onClick={() => setAction('close')}>
              <CalendarCheck2 /> {t('Close event')}
            </Button>
          )}
        </div>
      )}

      <SectionTitle
        action={
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={exportCsv}>
              <Download /> CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={exportPdf}>
              <FileText /> PDF
            </Button>
          </div>
        }
      >
        {t('Flats')}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {r.units.map((u) => (
          <UnitLink
            key={u.unit_id}
            unitId={u.unit_id}
            className={cn('rounded-2xl border bg-card p-3 shadow-card transition-colors hover:bg-secondary/50', !u.expected && 'opacity-60')}
          >
            <div className="flex items-center justify-between">
              <span className="tabular font-bold">{u.unit_code}</span>
            </div>
            <div className="mt-1.5">
              <StatusChip status={u.status} />
            </div>
            <p className="tabular mt-1.5 text-[12px] text-muted-foreground">
              {u.expected ? `${formatINR(u.paid_paise)} / ${formatINR(u.due_paise)}` : u.exclusion_reason}
            </p>
            {u.extra_paise > 0 && <p className="tabular text-[11.5px] font-semibold text-credit">+{formatINR(u.extra_paise)} {t('extra')}</p>}
          </UnitLink>
        ))}
      </div>

      {r.entries.length > 0 && (
        <>
          <SectionTitle>{t('Entries')}</SectionTitle>
          <Card className="divide-y">
            {r.entries.map((x) => (
              <div key={x.entry_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-semibold', x.is_reversed && 'struck')}>
                    {x.unit_code ?? x.payee ?? categoryLabel(x.category)} {x.is_reversal && <Badge variant="info">{t('Reversal')}</Badge>}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {formatDate(x.date)} · {categoryLabel(x.category)}
                  </p>
                </div>
                <Money paise={x.direction === 'credit' ? x.amount_paise : -x.amount_paise} sign tone="auto" className={cn('font-bold', x.is_reversed && 'struck')} />
              </div>
            ))}
          </Card>
        </>
      )}

      <ConfirmSheet
        open={action === 'open' || action === 'delete'}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === 'open' ? t('Open this event?') : t('Delete this draft?')}
        description={action === 'open' ? t('Dues are created for every expected flat and members are notified.') : t('Nothing was billed yet. This cannot be undone.')}
        rows={[
          { label: t('Per flat'), value: formatINR(e.per_unit_share_paise), strong: true },
          { label: t('Expected payers'), value: String(e.expected_count) },
        ]}
        confirmLabel={action === 'open' ? t('Open event') : t('Delete draft')}
        destructive={action === 'delete'}
        loading={busy}
        onConfirm={run}
      />
      <ConfirmSheet
        open={action === 'close'}
        onOpenChange={(o) => !o && setAction(null)}
        title={t('Close this event?')}
        description={
          r.balance_paise > 0
            ? t('The fund has a surplus of {{a}}.', { a: formatINR(r.balance_paise) })
            : r.balance_paise < 0
              ? t('The fund is short by {{a}}.', { a: formatINR(-r.balance_paise) })
              : t('The fund balance is zero.')
        }
        confirmLabel={t('Close event')}
        loading={busy}
        onConfirm={run}
      >
        {r.balance_paise !== 0 && (
          <label className="mt-1 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-3">
            <span className="text-sm font-medium">
              {r.balance_paise > 0 ? t('Move the surplus to the General fund') : t('Cover the shortfall from the General fund')}
            </span>
            <Switch checked={settle} onCheckedChange={setSettle} />
          </label>
        )}
        <Field label={t('Note')} optional className="mt-3">
          <Input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300} />
        </Field>
        {r.remaining_to_collect_paise > 0 && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {t('{{a}} is still pending from flats. Their dues stay open after closing.', { a: formatINR(r.remaining_to_collect_paise) })}
          </p>
        )}
      </ConfirmSheet>
      <ConfirmSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        title={e.status === 'draft' ? t('Edit draft event') : t('Edit target amount')}
        description={
          e.status === 'draft'
            ? t('Nothing has been billed yet, so you can change anything.')
            : t('The amount is re-split across the paying flats. Every flat must read and accept the change before using the app. This only works while no flat has paid yet.')
        }
        confirmLabel={t('Save changes')}
        loading={editBusy}
        onConfirm={saveEdit}
      >
        {e.status === 'draft' ? (
          <>
            <Field label={t('Title')} className="mt-1">
              <Input value={editTitle} onChange={(ev) => setEditTitle(ev.target.value)} maxLength={120} />
            </Field>
            <Field label={t('Description')} optional className="mt-3">
              <Input value={editDesc} onChange={(ev) => setEditDesc(ev.target.value)} maxLength={2000} />
            </Field>
            <Field label={t('Due date')} className="mt-3">
              <Input type="date" value={editDueDate} onChange={(ev) => setEditDueDate(ev.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('New total target')} className="mt-1">
              <AmountInput value={editTotal} onChange={(ev) => setEditTotal(ev.target.value)} />
            </Field>
            {(() => {
              const sp = summariseEventSplit(parseRupeesToPaise(editTotal) ?? 0, r.units.length, Object.keys(editExcluded).length, e.rounding_paise);
              return (
                <p className="tabular mt-2 rounded-xl bg-primary/10 px-3 py-2 text-[13px] font-semibold text-primary">
                  {t('{{s}} in scope, {{e}} expected → {{a}} per flat', { s: sp.inScope, e: sp.expected, a: formatINR(sp.sharePaise) })}
                </p>
              );
            })()}
            <p className="mt-3 text-[13px] font-semibold">{t('Who pays? Untick a flat to exclude it')}</p>
            <div className="mt-1.5 max-h-56 divide-y overflow-y-auto rounded-xl border">
              {r.units.map((u) => {
                const out = u.unit_id in editExcluded;
                return (
                  <div key={u.unit_id} className="px-3 py-2">
                    <label className="flex min-h-9 cursor-pointer items-center gap-3">
                      <Checkbox
                        checked={!out}
                        onCheckedChange={() =>
                          setEditExcluded((ex) => {
                            const n = { ...ex };
                            if (out) delete n[u.unit_id];
                            else n[u.unit_id] = '';
                            return n;
                          })
                        }
                      />
                      <span className="tabular w-16 text-sm font-bold">{u.unit_code}</span>
                      <span className="truncate text-[12.5px] text-muted-foreground">{u.unit_name}</span>
                    </label>
                    {out && (
                      <Input
                        className="mt-1.5 h-9 text-sm"
                        placeholder={t('Reason, e.g. owner abroad')}
                        value={editExcluded[u.unit_id]}
                        onChange={(ev) => setEditExcluded((ex) => ({ ...ex, [u.unit_id]: ev.target.value }))}
                        maxLength={200}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <Field label={t('Reason (members will see this)')} className="mt-3">
              <Input value={editReason} onChange={(ev) => setEditReason(ev.target.value)} maxLength={300} placeholder={t('e.g. Quote came in lower than expected')} />
            </Field>
          </>
        )}
      </ConfirmSheet>
    </div>
  );
}
