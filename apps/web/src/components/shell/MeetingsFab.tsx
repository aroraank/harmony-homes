import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarHeart, KeyRound, ListChecks, Plus, UserCog } from 'lucide-react';
import { useAuth, useMember } from '@/lib/auth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Quick-actions FAB on the Meetings & events hub, for every member (not just admins):
 * add a meeting, jump to the full meetings or events list, or get to their own profile / PIN.
 */
export function MeetingsFab({ onShowMeetings }: { onShowMeetings: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const m = useMember();
  const { viewOnly } = useAuth();
  const [open, setOpen] = useState(false);

  if (viewOnly) return null;

  const actions: { label: string; hint: string; Icon: typeof Plus; onClick: () => void }[] = [
    ...(m.can('manage_meetings')
      ? [
          {
            label: t('Add new meeting'),
            hint: t('Set a date, time and agenda'),
            Icon: Plus,
            onClick: () => nav('/meetings/new'),
          },
        ]
      : []),
    {
      label: t('List meetings'),
      hint: t('Upcoming, past and draft meetings'),
      Icon: CalendarClock,
      onClick: onShowMeetings,
    },
    {
      label: t('All events'),
      hint: t('Special collections like repairs'),
      Icon: CalendarHeart,
      onClick: () => nav('/events'),
    },
    {
      label: t('My profile'),
      hint: t('Name, language and devices'),
      Icon: UserCog,
      onClick: () => nav('/profile'),
    },
    {
      label: t('Update PIN'),
      hint: t('Change your sign-in PIN'),
      Icon: KeyRound,
      onClick: () => nav('/profile'),
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[88px] left-4 z-30 grid size-14 cursor-pointer place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lift transition-transform hover:scale-105 active:scale-95 sm:left-[max(1rem,calc(50%-22rem))]"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        aria-label={t('Quick actions')}
      >
        <ListChecks className="size-7" strokeWidth={2.6} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Quick actions')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onClick();
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
