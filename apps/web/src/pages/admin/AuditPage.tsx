import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileClock, Link2, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useUnits } from '@/lib/queries';
import { auditRisk, changedKeys, describeAudit } from '@/lib/audit';
import { cn, deviceLabel } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { AuditRow } from '@/types';

const PAGE = 50;
const TABLES = ['ledger_entries', 'dues', 'payment_claims', 'memberships', 'society_settings', 'month_closings', 'events', 'notices', 'units', 'concerns', 'contacts', 'reminder_schedules', 'role_permissions', 'auth'];

export default function AuditPage() {
  const { t } = useTranslation();
  const m = useMember();
  const units = useUnits(m.societyId);
  const unitMap = useMemo(() => Object.fromEntries((units.data ?? []).map((u) => [u.id, u.code])), [units.data]);
  const [table, setTable] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [riskyOnly, setRiskyOnly] = useState(false);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; broken_at?: number; reason?: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const people = useQuery({
    queryKey: ['auditPeople', m.societyId],
    queryFn: async () =>
      unwrap<{ user_id: string; role: string; profiles: { full_name: string } | null; units: { code: string } | null }[]>(
        await supabase.from('memberships').select('user_id, role, profiles!memberships_user_id_fkey(full_name), units(code)').eq('society_id', m.societyId),
      ),
  });
  const nameOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of people.data ?? []) map[p.user_id] = `${p.profiles?.full_name ?? '?'}${p.role !== 'resident' ? ` (${p.role.replace('_', ' ')})` : p.units ? ` (${p.units.code})` : ''}`;
    return map;
  }, [people.data]);

  const q = useInfiniteQuery({
    queryKey: ['audit', m.societyId, table, actor, from, to],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let qb = supabase.from('audit_log').select('id, society_id, actor_id, action, table_name, row_id, before, after, ip, user_agent, created_at').eq('society_id', m.societyId);
      if (table) qb = qb.eq('table_name', table);
      if (actor) qb = qb.eq('actor_id', actor);
      if (from) qb = qb.gte('created_at', `${from}T00:00:00+05:30`);
      if (to) qb = qb.lte('created_at', `${to}T23:59:59+05:30`);
      if (!table) qb = qb.neq('table_name', 'due_allocations');
      return unwrap<AuditRow[]>(await qb.order('id', { ascending: false }).range(pageParam, pageParam + PAGE - 1));
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const rows = (q.data?.pages.flat() ?? []).filter((r) => !riskyOnly || auditRisk(r));

  const runVerify = async () => {
    setVerifying(true);
    try {
      setVerify(await rpc('verify_audit_chain', { p_society: m.societyId }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Audit log')} subtitle={m.isSuperAdmin || m.can('view_audit_all') ? t('Every change, tamper-evident') : t('Your own actions')} back="/more" />
      {m.isSuperAdmin && (
        <div className="mb-3">
          <Button variant="outline" className="w-full" onClick={runVerify} loading={verifying}>
            <Link2 /> {t('Verify audit chain')}
          </Button>
          {verify && (
            <Alert variant={verify.ok ? 'success' : 'danger'} className="mt-2">
              {verify.ok ? <ShieldCheck /> : <ShieldX />}
              {verify.ok
                ? t('Chain intact — {{n}} records verified. Nothing was altered or deleted.', { n: verify.checked })
                : t('Chain broken at record #{{id}} ({{r}}). Someone changed the database directly.', { id: verify.broken_at, r: verify.reason })}
            </Alert>
          )}
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <NativeSelect value={table} onChange={(e) => setTable(e.target.value)} className="h-11 text-sm" aria-label={t('What')}>
          <option value="">{t('Everything')}</option>
          {TABLES.map((x) => (
            <option key={x} value={x}>
              {x.replace(/_/g, ' ')}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={actor} onChange={(e) => setActor(e.target.value)} className="h-11 text-sm" aria-label={t('Who')}>
          <option value="">{t('Anyone')}</option>
          {(people.data ?? [])
            .filter((p) => p.role !== 'resident')
            .map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {nameOf[p.user_id]}
              </option>
            ))}
        </NativeSelect>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 text-sm" aria-label={t('From')} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 text-sm" aria-label={t('To')} />
      </div>
      <label className="mb-3 flex cursor-pointer items-center gap-2 px-1 text-sm font-semibold">
        <Switch checked={riskyOnly} onCheckedChange={setRiskyOnly} /> {t('Only risky actions')}
      </label>

      {q.isLoading && !q.data ? (
        <ListSkeleton rows={8} />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileClock className="size-7" />} title={t('No matching activity')} />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
          {rows.map((r, i) => {
            const risk = auditRisk(r);
            return (
              <button key={r.id} type="button" onClick={() => setOpen(r)} className={cn('block w-full cursor-pointer px-4 py-3 text-left hover:bg-secondary/50', i > 0 && 'border-t', risk && 'bg-amber-50/60 dark:bg-amber-500/5')}>
                <div className="flex items-start gap-2">
                  {risk && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                  <p className="min-w-0 flex-1 text-[13.5px] leading-snug">
                    <strong>{r.actor_id ? (nameOf[r.actor_id] ?? t('Someone')) : t('System')}</strong> {describeAudit(r, unitMap)}
                  </p>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                  {formatDateTime(r.created_at)}
                  {r.ip ? ` · ${r.ip}` : ''}
                  {risk && <Badge variant="warning">{t(risk)}</Badge>}
                </p>
              </button>
            );
          })}
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="outline" className="mt-3 w-full" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t('Load more')}
        </Button>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  #{open.id} · {open.table_name} · {open.action}
                </DialogTitle>
              </DialogHeader>
              <p className="text-[13px]">
                <strong>{open.actor_id ? (nameOf[open.actor_id] ?? open.actor_id) : t('System')}</strong> {describeAudit(open, unitMap)}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {formatDateTime(open.created_at)} {open.ip ? `· ${open.ip}` : ''} {open.user_agent ? `· ${deviceLabel(open.user_agent)}` : ''}
              </p>
              <div className="mt-3 overflow-hidden rounded-2xl border text-[12.5px]">
                <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted px-3 py-2 font-semibold">
                  <span>{t('Field')}</span>
                  <span>{t('Before')}</span>
                  <span>{t('After')}</span>
                </div>
                {(open.action === 'update' ? changedKeys(open.before ?? {}, open.after ?? {}) : Object.keys(open.after ?? open.before ?? {})).map((k) => (
                  <div key={k} className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-t px-3 py-1.5">
                    <span className="break-all font-mono text-[11.5px] text-muted-foreground">{k}</span>
                    <span className="break-all">{fmt(open.before?.[k])}</span>
                    <span className="break-all font-medium">{fmt(open.after?.[k])}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
