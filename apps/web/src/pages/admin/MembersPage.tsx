import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, KeyRound, LogOut, MoreVertical, Pencil, Printer, ShieldCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, MOBILE_RE, normalizeMobile } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, invokeFn, rpc, supabase } from '@/lib/supabase';
import { unwrap, useUnits } from '@/lib/queries';
import { brand } from '@/brand';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MemberRow, Role } from '@/types';

type Row = MemberRow & { units: { code: string; display_name: string } | null };
type Slip = { unit_code?: string; display_name?: string; username: string; password: string };

export default function MembersPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const units = useUnits(m.societyId);
  const [tab, setTab] = useState('active');
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [roleFor, setRoleFor] = useState<Row | null>(null);
  const [deact, setDeact] = useState<Row | null>(null);
  const [confirmReset, setConfirmReset] = useState<Row | null>(null);
  const [approveFor, setApproveFor] = useState<Row | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['members', m.societyId],
    queryFn: async () =>
      unwrap<Row[]>(
        await supabase
          .from('memberships')
          .select('id, user_id, society_id, unit_id, role, status, created_at, deactivated_reason, profiles!memberships_user_id_fkey(full_name, phone, must_change_password), units(code, display_name)')
          .eq('society_id', m.societyId)
          .order('created_at'),
      ),
  });

  const rows = q.data ?? [];
  const active = rows.filter((r) => r.status === 'active').sort((a, b) => (a.units?.code ?? 'ZZ' + a.role).localeCompare(b.units?.code ?? 'ZZ' + b.role));
  const pending = rows.filter((r) => r.status === 'pending');
  const deactivated = rows.filter((r) => r.status === 'deactivated');
  const withLogin = new Set(rows.filter((r) => r.status !== 'deactivated' && r.unit_id).map((r) => r.unit_id));
  const needLogin = (units.data ?? []).filter((u) => !withLogin.has(u.id));
  const [selected, setSelected] = useState<string[]>([]);
  const allSelected = needLogin.length > 0 && needLogin.every((u) => selected.includes(u.id));

  const refresh = () => void qc.invalidateQueries({ queryKey: ['members'] });

  if (!m.can('manage_users')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const bulkCreate = async () => {
    setBusy(true);
    try {
      const r = await invokeFn<{ slips: Slip[]; errors: { unit_code: string; error: string }[] }>('admin-users', {
        action: 'bulk_create_logins',
        society_id: m.societyId,
        unit_ids: selected.length ? selected : null,
      });
      if (r.errors.length) toast.error(t('{{n}} logins could not be created: {{list}}', { n: r.errors.length, list: r.errors.map((e) => `${e.unit_code} (${e.error})`).join(', ') }));
      if (r.slips.length) setSlips(r.slips);
      setSelected([]);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (row: Row) => {
    setBusy(true);
    try {
      const r = await invokeFn<{ username: string; password: string; unit_code: string | null }>('admin-users', { action: 'reset_password', membership_id: row.id });
      setSlips([{ username: r.username, password: r.password, unit_code: r.unit_code ?? undefined, display_name: row.profiles?.full_name }]);
      setConfirmReset(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const forceSignOut = async (row: Row) => {
    try {
      const n = await rpc<number>('admin_sign_out_member', { p_membership_id: row.id });
      toast.success(t('Signed out {{n}} device(s)', { n }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const reject = async (row: Row) => {
    try {
      await rpc('reject_registration', { p_membership_id: row.id, p_reason: 'Rejected by admin' });
      toast.success(t('Registration rejected'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const roleLabel = (r: Role) => (r === 'super_admin' ? t('Super admin') : r === 'admin' ? t('Admin') : t('Resident'));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Members & logins')}
        back="/more"
        actions={
          <Button size="sm" variant="outline" onClick={() => setStaffOpen(true)}>
            <UserPlus /> {t('Staff')}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">
            {t('Active')} ({active.length})
          </TabsTrigger>
          <TabsTrigger value="logins">
            {t('Create logins')} {needLogin.length > 0 && <Badge variant="warning">{needLogin.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending">
            {t('Requests')} {pending.length > 0 && <Badge variant="danger">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="old">{t('Old')}</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <QueryState query={q} empty={() => (active.length ? null : <EmptyState icon={<Users className="size-7" />} title={t('No members yet')} />)}>
            {() => (
              <Card className="divide-y">
                {active.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="tabular w-16 shrink-0 font-bold">{r.units?.code ?? '—'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.profiles?.full_name}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {r.profiles?.phone ?? t('No mobile')}
                        {r.profiles?.must_change_password && <span className="text-warning"> · {t('has not set a password yet')}</span>}
                      </p>
                    </div>
                    {r.role !== 'resident' && <Badge variant={r.role === 'super_admin' ? 'default' : 'info'}>{roleLabel(r.role)}</Badge>}
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-muted" aria-label={t('Actions for {{n}}', { n: r.units?.code ?? r.profiles?.full_name })}>
                        <MoreVertical className="size-5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEdit(r)}>
                          <Pencil /> {t('Edit name & mobile')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirmReset(r)}>
                          <KeyRound /> {t('Reset password')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void forceSignOut(r)}>
                          <LogOut /> {t('Sign out all devices')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRoleFor(r)}>
                          <ShieldCheck /> {t('Change role')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => setDeact(r)}>
                          <UserMinus /> {t('Deactivate')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </Card>
            )}
          </QueryState>
        </TabsContent>

        <TabsContent value="logins">
          <Alert variant="info" className="mb-3">
            {t('Each flat gets one login. Username = flat code. A unique temporary password is shown once on printable slips; members must set their own password at first sign-in.')}
          </Alert>
          {needLogin.length === 0 ? (
            <EmptyState title={t('Every flat has a login')} />
          ) : (
            <>
              <label className="mb-2 flex cursor-pointer items-center gap-2 px-1 text-sm font-semibold">
                <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? [] : needLogin.map((u) => u.id))} />
                {t('Select all ({{n}})', { n: needLogin.length })}
              </label>
              <Card className="grid grid-cols-3 gap-1.5 p-2 sm:grid-cols-4">
                {needLogin.map((u) => (
                  <label key={u.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-muted">
                    <Checkbox checked={selected.includes(u.id)} onCheckedChange={() => setSelected((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} />
                    <span className="tabular text-[13px] font-semibold">{u.code}</span>
                  </label>
                ))}
              </Card>
              <Button className="mt-3 w-full" size="lg" onClick={bulkCreate} loading={busy} disabled={!selected.length}>
                <KeyRound /> {t('Create {{n}} logins', { n: selected.length })}
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="pending">
          {pending.length === 0 ? (
            <EmptyState title={t('No registration requests')} />
          ) : (
            <div className="space-y-2">
              {pending.map((r) => {
                const taken = rows.some((x) => x.status === 'active' && x.unit_id === r.unit_id);
                return (
                  <Card key={r.id} className="p-4">
                    <p className="font-semibold">
                      <span className="tabular">{r.units?.code}</span> · {r.profiles?.full_name}
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      {r.profiles?.phone} · {formatDateTime(r.created_at)}
                    </p>
                    {taken && <p className="mt-1 text-[12.5px] font-semibold text-warning">{t('This flat already has an active login. Approving will replace it.')}</p>}
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => setApproveFor(r)}>
                        <Check /> {t('Approve')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void reject(r)}>
                        <X /> {t('Reject')}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="old">
          {deactivated.length === 0 ? (
            <EmptyState title={t('No deactivated members')} />
          ) : (
            <Card className="divide-y">
              {deactivated.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <p className="text-sm font-semibold">
                    <span className="tabular">{r.units?.code ?? '—'}</span> · {r.profiles?.full_name}
                  </p>
                  <p className="text-[12px] text-muted-foreground">{r.deactivated_reason}</p>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {slips && <SlipsDialog slips={slips} society={m.society_name} slug={m.society_slug} onClose={() => setSlips(null)} />}
      {edit && <EditMember row={edit} onClose={() => (setEdit(null), refresh())} />}
      {roleFor && <RoleDialog row={roleFor} canSuper={m.isSuperAdmin} onClose={() => (setRoleFor(null), refresh())} />}
      {deact && <DeactivateDialog row={deact} onClose={() => (setDeact(null), refresh())} />}
      {staffOpen && <StaffDialog canSuper={m.isSuperAdmin} onClose={() => setStaffOpen(false)} onSlip={(s) => (setSlips([s]), refresh())} />}
      {approveFor && <ApproveDialog row={approveFor} replace={rows.some((x) => x.status === 'active' && x.unit_id === approveFor.unit_id)} onClose={() => (setApproveFor(null), refresh())} />}
      <ConfirmSheet
        open={!!confirmReset}
        onOpenChange={(o) => !o && setConfirmReset(null)}
        title={t('Reset password for {{u}}?', { u: confirmReset?.units?.code ?? confirmReset?.profiles?.full_name ?? '' })}
        description={t('A new one-time password is created and all their devices are signed out. They must set a new password at next sign-in.')}
        confirmLabel={t('Reset password')}
        destructive
        loading={busy}
        onConfirm={() => confirmReset && void reset(confirmReset)}
      />
    </div>
  );
}

function SlipsDialog({ slips, society, slug, onClose }: { slips: Slip[]; society: string; slug: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const url = window.location.origin;
  const printSlips = () => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return toast.error(t('Allow pop-ups to print the slips.'));
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(brand.name)} credential slips</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;color:#0b1f19}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.slip{border:2px dashed #059669;border-radius:12px;padding:12px;break-inside:avoid}.b{color:#047857;font-weight:800}.pw{font:700 20px ui-monospace,monospace;letter-spacing:1px;background:#ecfdf5;padding:6px 8px;border-radius:8px;display:inline-block}
small{color:#456}</style></head><body><div class="grid">${slips
      .map(
        (s) => `<div class="slip"><div class="b">${esc(brand.name)}</div><small>${esc(society)}</small>
<p>Flat: <b>${esc(s.unit_code ?? '')}</b> ${esc(s.display_name ?? '')}</p><p>Society code: <b>${esc(slug)}</b><br>Username: <b>${esc(s.username)}</b></p>
<p>Temporary password:<br><span class="pw">${esc(s.password)}</span></p><small>Open ${esc(url)} → sign in → set your own password. Do not share this slip.</small></div>`,
      )
      .join('')}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && ack && onClose()}>
      <DialogContent dismissible={false}>
        <DialogHeader>
          <DialogTitle>{t('Credential slips')}</DialogTitle>
        </DialogHeader>
        <Alert variant="warning" className="mb-3">
          {t('These passwords are shown only once and are never stored in readable form. Print or note them now and hand each slip over individually.')}
        </Alert>
        <div className="grid max-h-[45dvh] gap-2 overflow-y-auto">
          {slips.map((s) => (
            <div key={s.username} className="rounded-2xl border-2 border-dashed border-primary/50 p-3">
              <p className="text-[12px] text-muted-foreground">
                {s.unit_code ?? ''} {s.display_name ? `· ${s.display_name}` : ''}
              </p>
              <p className="text-sm">
                {t('Username')}: <strong className="tabular">{s.username}</strong>
              </p>
              <p className="tabular mt-1 inline-block select-all rounded-lg bg-secondary px-2 py-1 font-mono text-lg font-bold tracking-wider">{s.password}</p>
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-3 w-full" onClick={printSlips}>
          <Printer /> {t('Print slips')}
        </Button>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} /> {t('I have saved or printed these passwords')}
        </label>
        <DialogFooter>
          <Button onClick={onClose} disabled={!ack}>
            {t('Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMember({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(row.profiles?.full_name ?? '');
  const [phone, setPhone] = useState(row.profiles?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = phone.trim() ? normalizeMobile(phone) : null;
    if (p && !MOBILE_RE.test(p)) return toast.error(t('Enter a valid 10-digit Indian mobile number'));
    setBusy(true);
    try {
      await rpc('admin_update_member_profile', { p_membership_id: row.id, p_full_name: name.trim(), p_phone: p });
      toast.success(t('Saved'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.units?.code ?? t('Staff')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Full name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Mobile number')} optional>
            <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ row, canSuper, onClose }: { row: Row; canSuper: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Role>(row.role);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await rpc('set_member_role', { p_membership_id: row.id, p_role: role });
      toast.success(t('Role updated'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Change role')}</DialogTitle>
        </DialogHeader>
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {row.unit_id && <option value="resident">{t('Resident')}</option>}
          <option value="admin">{t('Admin')}</option>
          {(canSuper || row.role === 'super_admin') && <option value="super_admin">{t('Super admin')}</option>}
        </NativeSelect>
        <p className="mt-2 text-[12.5px] text-muted-foreground">{t('Role changes are highlighted in the audit log. There must always be at least one super admin.')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={busy} disabled={role === row.role}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await rpc('deactivate_membership', { p_membership_id: row.id, p_reason: reason });
      toast.success(t('Member deactivated'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Deactivate {{u}}?', { u: row.units?.code ?? row.profiles?.full_name ?? '' })}
      description={t('They lose access immediately and their devices are signed out. The flat can then get a new login.')}
      confirmLabel={t('Deactivate')}
      destructive
      loading={busy}
      onConfirm={go}
    >
      <Field label={t('Reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t('e.g. flat sold')} />
      </Field>
    </ConfirmSheet>
  );
}

function ApproveDialog({ row, replace, onClose }: { row: Row; replace: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await invokeFn('admin-users', { action: 'approve_registration', membership_id: row.id, replace });
      toast.success(t('Approved. {{n}} can now sign in as {{u}}.', { n: row.profiles?.full_name ?? '', u: row.units?.code ?? '' }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Approve {{n}} for {{u}}?', { n: row.profiles?.full_name ?? '', u: row.units?.code ?? '' })}
      description={replace ? t('The current login of this flat will be deactivated and signed out.') : t('They will sign in with the flat code and the password they chose.')}
      rows={[
        { label: t('Mobile'), value: row.profiles?.phone ?? '' },
        { label: t('Requested'), value: formatDateTime(row.created_at) },
      ]}
      confirmLabel={replace ? t('Replace and approve') : t('Approve')}
      destructive={replace}
      loading={busy}
      onConfirm={go}
    />
  );
}

function StaffDialog({ canSuper, onClose, onSlip }: { canSuper: boolean; onClose: () => void; onSlip: (s: Slip) => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'admin' | 'super_admin'>('admin');
  const [busy, setBusy] = useState(false);
  const valid = useMemo(() => /^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(username) && name.trim().length >= 2, [username, name]);
  const go = async () => {
    const p = phone.trim() ? normalizeMobile(phone) : null;
    if (p && !MOBILE_RE.test(p)) return toast.error(t('Enter a valid 10-digit Indian mobile number'));
    setBusy(true);
    try {
      const r = await invokeFn<{ username: string; password: string }>('admin-users', {
        action: 'create_staff',
        society_id: m.societyId,
        username,
        full_name: name.trim(),
        phone: p,
        role,
      });
      onSlip({ username: r.username, password: r.password, display_name: name });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Add committee / staff login')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Username')} hint={t('Letters, digits, dashes — e.g. rohit-admin')}>
            <Input value={username} onChange={(e) => setUsername(e.target.value.trim())} autoCapitalize="none" />
          </Field>
          <Field label={t('Full name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Mobile number')} optional>
            <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('Role')}>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'super_admin')}>
              <option value="admin">{t('Admin')}</option>
              {canSuper && <option value="super_admin">{t('Super admin')}</option>}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={go} loading={busy} disabled={!valid}>
            {t('Create login')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
