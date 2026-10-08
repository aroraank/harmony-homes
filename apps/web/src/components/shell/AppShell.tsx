import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CalendarHeart, Eye, Home, LayoutGrid, Megaphone, ScrollText, WalletCards, WifiOff } from 'lucide-react';
import { useAuth, useMember } from '@/lib/auth';
import { useDashboard, useNotifications } from '@/lib/queries';
import { useOnline } from '@/lib/online';
import { refreshPushRegistration } from '@/lib/push';
import { setLanguage } from '@/lib/i18n';
import { rpc } from '@/lib/supabase';
import { stopViewAs } from '@/lib/viewAs';
import { brand } from '@/brand';
import { cn } from '@/lib/utils';
import { NoticeGate } from './NoticeGate';
import { CreditLine } from '../CreditLine';
import { AdminFab } from './AdminFab';
import { ListSkeleton } from '../States';

export function AppShell() {
  const { t, i18n } = useTranslation();
  const m = useMember();
  const { memberships, viewOnly, viewAs, signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const hindi = i18n.language === 'hi';
  const toggleLang = () => {
    const next = hindi ? 'en' : 'hi';
    setLanguage(next);
    void rpc('set_my_locale', { p_locale: next }).catch(() => undefined);
  };
  const online = useOnline();
  const loc = useLocation();
  const dash = useDashboard(m.societyId);
  const notif = useNotifications();
  const unread = (notif.data ?? []).filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!viewOnly) void refreshPushRegistration();
  }, [m.userId, viewOnly]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  const tabs = [
    { to: '/', label: t('Home'), Icon: Home, end: true },
    { to: '/dues', label: t('Dues'), Icon: WalletCards },
    { to: '/ledger', label: t('Ledger'), Icon: ScrollText },
    { to: '/events', label: t('Events'), Icon: CalendarHeart },
    { to: '/notices', label: t('Notices'), Icon: Megaphone, badge: dash.data?.unacked_notices ?? 0 },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="hero-gradient safe-top sticky top-0 z-30 text-white shadow-md">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={brand.name}>
            <img src={brand.logo} alt="" className="size-8 rounded-[10px] ring-1 ring-white/30" width={32} height={32} />
            <div className="min-w-0 leading-tight">
              <div className="text-[15px] font-extrabold tracking-tight">{brand.name}</div>
              <div className="truncate text-[11.5px] font-medium text-white/80">
                {m.society_name}
                {memberships.length > 1 ? ' · ' + t('switch in menu') : ''}
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={toggleLang}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-[15px] font-extrabold hover:bg-white/15"
            style={{ fontFamily: 'system-ui, sans-serif' }}
            aria-label={hindi ? 'Switch to English' : 'हिन्दी में बदलें'}
            title={hindi ? 'English' : 'हिन्दी'}
          >
            {hindi ? 'En' : 'अ'}
          </button>
          <Link
            to="/notifications"
            className="relative grid size-11 place-items-center rounded-full hover:bg-white/15"
            aria-label={t('Notifications') + (unread ? ` (${unread})` : '')}
          >
            <Bell className="size-[22px]" />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-lime-300 px-1 text-[10.5px] font-extrabold text-emerald-950">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
          <Link to="/more" className="grid size-11 place-items-center rounded-full hover:bg-white/15" aria-label={t('Menu')}>
            <LayoutGrid className="size-[22px]" />
          </Link>
        </div>
        {viewOnly && (
          <div className="flex items-center gap-2 bg-amber-300 px-4 py-2 text-[12.5px] font-semibold text-amber-950" role="status">
            <Eye className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {viewAs ? t('Viewing as {{who}} — read only', { who: viewAs.label }) : t('Read-only session')}
            </span>
            <button
              type="button"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                if (viewAs) await stopViewAs();
                else await signOut();
              }}
              className="min-h-9 shrink-0 cursor-pointer rounded-full bg-amber-950 px-3 text-[12px] font-bold text-amber-50 disabled:opacity-60"
            >
              {viewAs ? t('Back to my account') : t('Sign out')}
            </button>
          </div>
        )}
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-[12.5px] font-semibold text-amber-950">
            <WifiOff className="size-4" /> {t("You're offline — showing saved data. Changes are disabled.")}
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pb-32 pt-4">
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <Outlet />
        </Suspense>
        <CreditLine className="mt-10" />
      </main>

      {m.isAdmin && !viewOnly && ['/', '/dues', '/ledger', '/events', '/notices'].includes(loc.pathname) && <AdminFab />}

      <nav
        aria-label={t('Main')}
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85"
      >
        <ul className="grid grid-cols-5">
          {tabs.map(({ to, label, Icon, end, badge }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'group flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'relative grid h-8 w-14 place-items-center rounded-full transition-colors',
                        isActive ? 'bg-primary/12' : 'group-hover:bg-muted',
                      )}
                    >
                      <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                      {!!badge && (
                        <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                          {badge > 9 ? '9+' : badge}
                        </span>
                      )}
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {!viewOnly && <NoticeGate />}
    </div>
  );
}
