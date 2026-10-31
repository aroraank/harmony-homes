import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, KeyRound, Power, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, MOBILE_RE, normalizeMobile } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, invokeFn, rpc } from '@/lib/supabase';
import { PageHeader } from '@/components/PageHeader';
import { PhoneInput } from '@/components/PhoneInput';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GuardRow } from '@/types';

type Slip = { username: string; password: string; name?: string };

/**
 * Gate logins for the security guards. A gate login is not a member: it opens the gate
 * screen only and can see no money, dues, members or contacts.
 */
export default function GateLoginsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [resetFor, setResetFor] = useState<GuardRow | null>(null);
  const [toggleFor, setToggleFor] = useState<GuardRow | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['guards', m.societyId],
    enabled: m.can('manage_users'),
    queryFn: () => rpc<GuardRow[]>('guard_list', { p_society: m.societyId }),
  });

  if (!m.can('manage_users')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['guards'] });

  const resetPin = async () => {
    if (!resetFor) return;
    setBusy(true);
    try {
      const r = await invokeFn<{ username: string; password: string }>('admin-users', {
        action: 'reset_guard_password',
        guard_id: resetFor.id,
      });
      setSlip({ username: r.username, password: r.password, name: resetFor.full_name });
      setResetFor(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!toggleFor) return;
    setBusy(true);
    try {
      await rpc('set_guard_status', {
        p_guard_id: toggleFor.id,
        p_status: toggleFor.status === 'active' ? 'disabled' : 'active',
      });
      toast.success(t('Saved'));
      setToggleFor(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Gate logins')}
        subtitle={t('Logins for the security guard at the gate.')}
        back
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus /> {t('Add')}
          </Button>
        }
      />

      <Alert>
        {t(
          'A gate login only opens the gate screen: check a vehicle number, mark a guest IN and mark it OUT. It cannot see dues, money, members or contacts.',
        )}
      </Alert>

      <div className="mt-3">
        <QueryState
          query={q}
          empty={(d) =>
            d.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="size-7" />}
                title={t('No gate login yet')}
                hint={t('Create one and hand the username and PIN to the guard.')}
                action={
                  <Button onClick={() => setAddOpen(true)}>
                    <UserPlus /> {t('Add gate login')}
                  </Button>
                }
              />
            ) : null
          }
        >
          {(list) => (
            <div className="space-y-2">
              {list.map((g) => (
                <Card key={g.id} className="flex items-center gap-3 p-3.5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    <ShieldCheck className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[15px] font-bold leading-tight">{g.full_name}</p>
                    <p className="break-words text-[12.5px] text-muted-foreground">
                      {g.phone ? `${g.phone} · ` : ''}
                      {t('Added')} {formatDateTime(g.created_at)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {g.status === 'active' ? (
                        <Badge variant="success">{t('Active')}</Badge>
                      ) : (
                        <Badge variant="muted">{t('Disabled')}</Badge>
                      )}
                      {g.must_change_password && <Badge variant="warning">{t('PIN not changed yet')}</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Reset PIN')}
                      onClick={() => setResetFor(g)}
                    >
                      <KeyRound />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={g.status === 'active' ? t('Disable') : t('Enable')}
                      onClick={() => setToggleFor(g)}
                    >
                      <Power className={g.status === 'active' ? 'text-destructive' : ''} />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </QueryState>
      </div>

      {addOpen && (
        <AddGuardDialog
          onClose={() => setAddOpen(false)}
          onCreated={(s) => {
            setSlip(s);
            setAddOpen(false);
            refresh();
          }}
        />
      )}

      <ConfirmSheet
        open={!!resetFor}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={t('Give a new PIN?')}
        description={t('{{name}} will be signed out and must set a new PIN at the next sign-in.', {
          name: resetFor?.full_name ?? '',
        })}
        confirmLabel={t('Create new PIN')}
        loading={busy}
        onConfirm={() => void resetPin()}
      />

      <ConfirmSheet
        open={!!toggleFor}
        onOpenChange={(o) => !o && setToggleFor(null)}
        title={toggleFor?.status === 'active' ? t('Disable this gate login?') : t('Enable this gate login?')}
        description={
          toggleFor?.status === 'active'
            ? t('The guard will not be able to open the gate screen.')
            : t('The guard will be able to open the gate screen again.')
        }
        confirmLabel={toggleFor?.status === 'active' ? t('Disable') : t('Enable')}
        destructive={toggleFor?.status === 'active'}
        loading={busy}
        onConfirm={() => void toggle()}
      />

      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlip(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Gate login created')}</DialogTitle>
          </DialogHeader>
          <Alert>{t('Write this down now — the PIN is shown only once.')}</Alert>
          <Card className="mt-3 space-y-2 p-4">
            {slip?.name && <p className="text-[15px] font-bold">{slip.name}</p>}
            <p className="text-[13px] text-muted-foreground">{t('Username')}</p>
            <p className="tabular text-[22px] font-extrabold tracking-wide">{slip?.username}</p>
            <p className="text-[13px] text-muted-foreground">{t('Temporary PIN')}</p>
            <p className="tabular text-[22px] font-extrabold tracking-[0.3em]">{slip?.password}</p>
          </Card>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${t('Username')}: ${slip?.username}\n${t('Temporary PIN')}: ${slip?.password}`)
                  .then(() => toast.success(t('Copied')))
                  .catch(() => toast.error(t('Could not copy')));
              }}
            >
              <Copy /> {t('Copy')}
            </Button>
            <Button onClick={() => setSlip(null)}>{t('Done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddGuardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Slip) => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const [username, setUsername] = useState('gate');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(username) && name.trim().length >= 2;

  const go = async () => {
    const p = phone.trim() ? normalizeMobile(phone) : null;
    if (p && !MOBILE_RE.test(p)) return toast.error(t('Enter a valid 10-digit Indian mobile number'));
    setBusy(true);
    try {
      const r = await invokeFn<{ username: string; password: string }>('admin-users', {
        action: 'create_guard',
        society_id: m.societyId,
        username,
        full_name: name.trim(),
        phone: p,
      });
      onCreated({ username: r.username, password: r.password, name: name.trim() });
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
          <DialogTitle>{t('Add gate login')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Username')} hint={t('Letters, digits, dashes — e.g. gate or gate-night')}>
            <Input
              value={username}
              maxLength={40}
              autoCapitalize="none"
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
            />
          </Field>
          <Field label={t('Guard name')}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Mobile number')} optional>
            <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void go()} loading={busy} disabled={!valid}>
            {t('Create login')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
