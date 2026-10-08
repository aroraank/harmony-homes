import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, IndianRupee, Megaphone, Plus, Receipt } from 'lucide-react';
import { useMember } from '@/lib/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import type { Permission } from '@/types';

export function AdminFab() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const m = useMember();
  const [open, setOpen] = useState(false);
  const actions: { label: string; hint: string; to: string; Icon: typeof Plus; perm: Permission }[] = [
    { label: t('Record payment'), hint: t('Money received from a flat'), to: '/admin/payment', Icon: IndianRupee, perm: 'record_payment' },
    { label: t('Record expense'), hint: t('Salary, bills, repairs'), to: '/admin/expense', Icon: Receipt, perm: 'record_expense' },
    { label: t('New notice'), hint: t('Broadcast with read receipts'), to: '/notices/new', Icon: Megaphone, perm: 'send_notices' },
    { label: t('Verify payment claims'), hint: t('Residents who said "I paid"'), to: '/admin/claims', Icon: BadgeCheck, perm: 'approve_claims' },
  ];
  const allowed = actions.filter((a) => m.can(a.perm));
  if (!allowed.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[88px] right-4 z-30 grid size-14 cursor-pointer place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lift transition-transform hover:scale-105 active:scale-95 sm:right-[max(1rem,calc(50%-22rem))]"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        aria-label={t('Quick actions')}
      >
        <Plus className="size-7" strokeWidth={2.6} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Quick actions')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {allowed.map((a) => (
              <button
                key={a.to}
                type="button"
                onClick={() => {
                  setOpen(false);
                  nav(a.to);
                }}
                className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 text-left transition-colors hover:bg-secondary"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <a.Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{a.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
