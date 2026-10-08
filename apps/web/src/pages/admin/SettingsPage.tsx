import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, DatabaseBackup, Landmark, QrCode, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, istToday, isValidPeriod, paiseToInput, parseRupeesToPaise, UPI_RE } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, newIdemKey, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useFunds, useSettings } from '@/lib/queries';
import { signedUrl, uploadFile } from '@/lib/files';
import { downloadBlob } from '@/lib/csv';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, CardSkeleton } from '@/components/States';
import { Field } from '@/components/Field';
import { FileInput } from '@/components/FileInput';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/alert';
import type { Permission } from '@/types';

const PERM_LABELS: Record<Permission, string> = {
  record_payment: 'Record payments',
  record_expense: 'Record expenses',
  approve_claims: 'Approve payment claims',
  reverse_entry: 'Reverse entries',
  manage_events: 'Create and close events, move money between funds',
  generate_dues: 'Generate and waive dues',
  close_month: 'Close months',
  reopen_month: 'Reopen closed months',
  send_notices: 'Send notices and see read receipts',
  manage_units: 'Manage flats and blocks',
  manage_users: 'Manage members, logins and passwords',
  manage_settings: 'Change society settings and payment details',
  view_audit_all: 'See the full audit log',
  manage_contacts: 'Manage contacts directory',
  manage_reminders: 'Manage maintenance reminders',
  manage_concerns: 'Handle member concerns',
  record_adjustment: 'Record opening balance and adjustments',
};
const ADMIN_DEFAULTS: Permission[] = ['record_payment', 'record_expense', 'approve_claims', 'reverse_entry', 'manage_events', 'generate_dues', 'close_month', 'send_notices', 'manage_contacts', 'manage_reminders', 'manage_concerns'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const s = useSettings(m.societyId);
  const funds = useFunds(m.societyId);
  const soc = useQuery({
    queryKey: ['society', m.societyId],
    queryFn: async () => unwrap<{ name: string; address: string | null }>(await supabase.from('societies').select('name, address').eq('id', m.societyId).single()),
  });
  const perms = useQuery({
    queryKey: ['rolePerms', m.societyId],
    enabled: m.isSuperAdmin,
    queryFn: async () => unwrap<{ permission: Permission; allowed: boolean }[]>(await supabase.from('role_permissions').select('permission, allowed').eq('society_id', m.societyId).eq('role', 'admin')),
  });

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [monthly, setMonthly] = useState('');
  const [dueDay, setDueDay] = useState('7');
  const [startMonth, setStartMonth] = useState('');
  const [rounding, setRounding] = useState('');
  const [prefix, setPrefix] = useState('HH');
  const [lateFlag, setLateFlag] = useState(true);
  const [upi, setUpi] = useState('');
  const [payee, setPayee] = useState('');
  const [bank, setBank] = useState('');
  const [qr, setQr] = useState<File | null>(null);
  const [retention, setRetention] = useState('180');
  const [purgeDays, setPurgeDays] = useState('90');
  const [opening, setOpening] = useState('');
  const [openingDate, setOpeningDate] = useState(istToday());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUpi, setConfirmUpi] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [confirmOpening, setConfirmOpening] = useState(false);

  useEffect(() => {
    const d = s.data;
    if (!d) return;
    setMonthly(paiseToInput(d.monthly_due_paise));
    setDueDay(String(d.due_day));
    setStartMonth(d.start_month);
    setRounding(paiseToInput(d.share_rounding_paise));
    setPrefix(d.receipt_prefix);
    setLateFlag(d.late_flag);
    setUpi(d.upi_id ?? '');
    setPayee(d.upi_payee_name ?? '');
    setBank(d.bank_account_name ?? '');
    setRetention(String(d.location_retention_days));
  }, [s.data]);
  useEffect(() => {
    if (soc.data) {
      setName(soc.data.name);
      setAddress(soc.data.address ?? '');
    }
  }, [soc.data]);

  const qrUrl = useQuery({ queryKey: ['qr', s.data?.upi_qr_path], enabled: !!s.data?.upi_qr_path, queryFn: () => signedUrl(s.data!.upi_qr_path!) });

  if (!m.can('manage_settings')) return <EmptyState title={t('You do not have permission to do this.')} />;
  if (s.isLoading || !s.data) return <CardSkeleton className="h-96" />;

  const patch = async (key: string, body: Record<string, unknown>, ok = t('Saved')) => {
    setBusy(key);
    try {
      await rpc('update_society_settings', { p_society: m.societyId, p_patch: body });
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['society'] });
      void qc.invalidateQueries({ queryKey: ['payInfo'] });
      void qc.invalidateQueries({ queryKey: ['ctx'] });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveDues = () => {
    const mp = parseRupeesToPaise(monthly);
    const rp = parseRupeesToPaise(rounding);
    const day = Number(dueDay);
    if (!mp) return toast.error(t('Enter the monthly amount'));
    if (!rp || rp < 100) return toast.error(t('Rounding must be between ₹1 and ₹10,000.'));
    if (!(day >= 1 && day <= 28)) return toast.error(t('Due day must be between 1 and 28.'));
    if (!isValidPeriod(startMonth)) return toast.error(t('Invalid start month.'));
    if (!/^[A-Z]{1,6}$/.test(prefix)) return toast.error(t('Receipt prefix must be 1–6 capital letters.'));
    void patch('dues', { monthly_due_paise: mp, due_day: day, start_month: startMonth, share_rounding_paise: rp, receipt_prefix: prefix, late_flag: lateFlag });
  };

  const saveUpi = async () => {
    setBusy('upi');
    try {
      let qrPath: string | undefined;
      if (qr) qrPath = await uploadFile(m.societyId, 'settings', 'upi', qr);
      const ok = await patch('upi', {
        upi_id: upi.trim() || null,
        upi_payee_name: payee.trim() || null,
        bank_account_name: bank.trim() || null,
        ...(qrPath ? { upi_qr_path: qrPath } : {}),
      }, t('Payment details saved. The super admin has been alerted.'));
      if (ok) {
        setQr(null);
        setConfirmUpi(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  const togglePerm = async (p: Permission, allowed: boolean) => {
    try {
      await rpc('set_role_permission', { p_society: m.societyId, p_role: 'admin', p_permission: p, p_allowed: allowed });
      void qc.invalidateQueries({ queryKey: ['rolePerms'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const permAllowed = (p: Permission) => perms.data?.find((x) => x.permission === p)?.allowed ?? ADMIN_DEFAULTS.includes(p);

  const purge = async () => {
    setBusy('purge');
    try {
      const n = await rpc<number>('purge_old_locations', { p_society: m.societyId, p_older_than_days: Number(purgeDays) });
      toast.success(t('Removed location from {{n}} acknowledgement(s)', { n }));
      setConfirmPurge(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveOpening = async () => {
    const p = parseRupeesToPaise(opening);
    const general = funds.data?.find((f) => f.kind === 'general');
    if (!p || !general) return;
    setBusy('opening');
    try {
      await rpc('record_adjustment', {
        p_fund_id: general.id,
        p_direction: 'credit',
        p_category: 'opening_balance',
        p_amount_paise: p,
        p_entry_date: openingDate,
        p_note: 'Opening balance as per bank',
        p_idempotency_key: newIdemKey('open'),
        p_backdate_reason: 'Opening balance',
      });
      toast.success(t('Opening balance recorded'));
      invalidateMoney(qc);
      setOpening('');
      setConfirmOpening(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    setBusy('backup');
    try {
      const tables = ['societies', 'society_settings', 'unit_types', 'blocks', 'floors', 'units', 'funds', 'expense_categories', 'events', 'event_units', 'ledger_entries', 'dues', 'due_allocations', 'month_closings', 'payment_claims', 'expense_templates', 'expense_drafts', 'notices', 'notice_receipts', 'contacts', 'contact_categories', 'reminder_schedules', 'reminder_occurrences', 'reminder_task_logs', 'memberships', 'alerts'];
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), society_id: m.societyId };
      for (const tb of tables) {
        const col = tb === 'societies' ? 'id' : 'society_id';
        const all: unknown[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(tb).select('*').eq(col, m.societyId).range(from, from + 999);
          if (error) throw error;
          all.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        out[tb] = all;
      }
      downloadBlob(`harmony-homes-backup-${istToday()}.json`, new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const upiValid = !upi.trim() || UPI_RE.test(upi.trim());
  const upiChanged = upi.trim() !== (s.data.upi_id ?? '') || payee.trim() !== (s.data.upi_payee_name ?? '') || bank.trim() !== (s.data.bank_account_name ?? '') || !!qr;

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Society settings')} back="/more" />

      <SectionTitle>{t('Society')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <Field label={t('Society name')} hint={t('Shown under the Harmony Homes brand everywhere')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('Address')} optional>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
        </Field>
        <Button onClick={() => patch('society', { society_name: name, society_address: address })} loading={busy === 'society'} disabled={name.trim().length < 2}>
          <Save /> {t('Save')}
        </Button>
      </Card>

      <SectionTitle>{t('Monthly dues')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Monthly amount (₹)')}>
            <Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Field>
          <Field label={t('Due day')}>
            <Input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </Field>
          <Field label={t('Start month')}>
            <Input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </Field>
          <Field label={t('Event rounding (₹)')}>
            <Input inputMode="numeric" value={rounding} onChange={(e) => setRounding(e.target.value)} />
          </Field>
          <Field label={t('Receipt prefix')}>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={6} />
          </Field>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between">
          <span className="text-sm font-semibold">{t('Flag dues as late after the due day')}</span>
          <Switch checked={lateFlag} onCheckedChange={setLateFlag} />
        </label>
        <p className="text-[12.5px] text-muted-foreground">{t('A different amount per flat type can be set in Flats & blocks → Flat types. Changes apply to dues generated from now on.')}</p>
        <Button onClick={saveDues} loading={busy === 'dues'}>
          <Save /> {t('Save')}
        </Button>
      </Card>

      <SectionTitle>{t('Payment details (UPI)')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <Alert variant="warning">
          <AlertTriangle />
          {t('Changing these redirects everyone’s payments. Every change is audited and the super admin is alerted immediately.')}
        </Alert>
        <Field label={t('Society UPI ID')} error={!upiValid ? t('Enter a valid UPI ID, e.g. society@okhdfcbank') : undefined}>
          <Input value={upi} onChange={(e) => setUpi(e.target.value)} autoCapitalize="none" placeholder="society@okhdfcbank" />
        </Field>
        <Field label={t('Payee name')}>
          <Input value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('Bank account name')} optional>
          <Input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('QR code image')} optional hint={t('Screenshot of the GPay / PhonePe QR is fine. PNG or JPG up to 2 MB.')}>
          <div className="space-y-2">
            {qrUrl.data && !qr && (
              <div className="flex items-center gap-3 rounded-2xl border p-2.5">
                <img src={qrUrl.data} alt={t('Current QR code')} className="size-16 rounded-lg bg-white object-contain" />
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <QrCode className="size-4" /> {t('Current QR')}
                </span>
              </div>
            )}
            <FileInput value={qr} onChange={setQr} imagesOnly maxBytes={2 * 1024 * 1024} label={t('Upload new QR')} />
          </div>
        </Field>
        <Button onClick={() => setConfirmUpi(true)} disabled={!upiValid || !upiChanged}>
          <Landmark /> {t('Save payment details')}
        </Button>
      </Card>

      {m.isSuperAdmin && (
        <>
          <SectionTitle>{t('What admins may do')}</SectionTitle>
          <Card className="divide-y">
            {(Object.keys(PERM_LABELS) as Permission[]).map((p) => (
              <label key={p} className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4">
                <span className="text-sm">{t(PERM_LABELS[p])}</span>
                <Switch checked={permAllowed(p)} onCheckedChange={(v) => void togglePerm(p, v)} />
              </label>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[12px] text-muted-foreground">{t('Enforced by the database, not just by hiding buttons. The super admin always has every permission.')}</p>
        </>
      )}

      {m.can('record_adjustment') && (
        <>
          <SectionTitle>{t('Opening balance')}</SectionTitle>
          <Card className="space-y-3 p-4">
            <p className="text-[13px] text-muted-foreground">{t('Record the bank balance on the day you start using Harmony Homes, so the app balance matches the bank. Only one opening balance per fund.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Amount (₹)')}>
                <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
              </Field>
              <Field label={t('As on')}>
                <Input type="date" value={openingDate} max={istToday()} onChange={(e) => setOpeningDate(e.target.value)} />
              </Field>
            </div>
            <Button variant="secondary" disabled={!parseRupeesToPaise(opening)} onClick={() => setConfirmOpening(true)}>
              {t('Record opening balance')}
            </Button>
          </Card>
        </>
      )}

      <SectionTitle>{t('Privacy')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <Field label={t('Keep acknowledgement locations for (days)')}>
          <div className="flex gap-2">
            <Input type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} />
            <Button variant="outline" onClick={() => patch('retention', { location_retention_days: Number(retention) })} loading={busy === 'retention'}>
              {t('Save')}
            </Button>
          </div>
        </Field>
        {m.isSuperAdmin && (
          <div className="flex items-end gap-2">
            <Field label={t('Purge locations older than (days)')} className="flex-1">
              <NativeSelect value={purgeDays} onChange={(e) => setPurgeDays(e.target.value)}>
                {['0', '30', '90', '180', '365'].map((d) => (
                  <option key={d} value={d}>
                    {d === '0' ? t('All') : d}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button variant="destructive" onClick={() => setConfirmPurge(true)}>
              <Trash2 /> {t('Purge')}
            </Button>
          </div>
        )}
      </Card>

      {m.isSuperAdmin && (
        <>
          <SectionTitle>{t('Backup')}</SectionTitle>
          <Card className="space-y-2 p-4">
            <p className="text-[13px] text-muted-foreground">{t('Download a full copy of the society’s data. The free hosting plan has no point-in-time restore, so do this weekly.')}</p>
            <Button variant="outline" onClick={backup} loading={busy === 'backup'}>
              <DatabaseBackup /> {t('Download backup (JSON)')}
            </Button>
          </Card>
        </>
      )}

      <ConfirmSheet
        open={confirmUpi}
        onOpenChange={setConfirmUpi}
        title={t('Change payment details?')}
        description={t('Members will pay to these details from now on.')}
        rows={[
          { label: t('UPI ID'), value: upi || '—', strong: true },
          { label: t('Payee'), value: payee || '—' },
          { label: t('New QR'), value: qr ? t('Yes') : t('No') },
        ]}
        confirmLabel={t('Save payment details')}
        loading={busy === 'upi'}
        onConfirm={saveUpi}
      >
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> {t('Recorded in the audit log with your name.')}
        </p>
      </ConfirmSheet>
      <ConfirmSheet open={confirmPurge} onOpenChange={setConfirmPurge} title={t('Purge locations?')} description={t('Latitude/longitude will be removed permanently. Acknowledgement times are kept.')} confirmLabel={t('Purge')} destructive loading={busy === 'purge'} onConfirm={purge} />
      <ConfirmSheet
        open={confirmOpening}
        onOpenChange={setConfirmOpening}
        title={t('Record opening balance?')}
        rows={[
          { label: t('Amount'), value: formatINR(parseRupeesToPaise(opening) ?? 0), strong: true },
          { label: t('As on'), value: openingDate },
        ]}
        confirmLabel={t('Record')}
        loading={busy === 'opening'}
        onConfirm={saveOpening}
      />
    </div>
  );
}
