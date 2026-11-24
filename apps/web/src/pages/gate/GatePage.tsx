import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bike,
  Car,
  CheckCircle2,
  Clock,
  History,
  Hourglass,
  LogOut,
  MoreHorizontal,
  PhoneCall,
  RotateCcw,
  Search,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime12, splitMinutes } from '@harmony/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { setLanguage } from '@/lib/i18n';
import { nudgePush } from '@/lib/push';
import { brand } from '@/brand';
import { cn } from '@/lib/utils';
import { VehicleKindChip, VehicleKindTile } from '@/components/VehicleKindChip';
import { GateVisitLogList } from '@/components/GateVisitLogList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import type { GateBoard, GateFlat, GateLookup, GateVehicleKind, GateVisitRow } from '@/types';

/** Vehicle-type buttons the guard taps when marking a guest IN — same colours as the VehicleKindChip
 *  shown everywhere else, so what he picks here is what he recognises later on the board and the log. */
const KIND_OPTIONS: { kind: GateVehicleKind; label: string; Icon: typeof Car; cls: string }[] = [
  { kind: 'car', label: 'Car', Icon: Car, cls: 'bg-sky-600' },
  { kind: 'bike', label: 'Bike', Icon: Bike, cls: 'bg-lime-600' },
  { kind: 'scooter', label: 'Scooter', Icon: Bike, cls: 'bg-emerald-600' },
  { kind: 'truck', label: 'Truck', Icon: Truck, cls: 'bg-rose-600' },
  { kind: 'other', label: 'Other', Icon: MoreHorizontal, cls: 'bg-slate-500' },
];

/** "21 Oct, 1:54 PM" */
const dt12 = (iso: string) => formatDateTime12(iso);

/**
 * How long a vehicle has been inside, as a live, ticking label ("2h 15m").
 * Keeps counting across the guard's shifts — a vehicle marked in yesterday and still open
 * today just shows a bigger number; it never resets or disappears until someone marks it OUT.
 */
function useElapsed(iso: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const totalMin = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  return splitMinutes(totalMin);
}

function ElapsedLabel({ iso }: { iso: string }) {
  const { t } = useTranslation();
  const { days, hours, minutes } = useElapsed(iso);
  let text: string;
  if (days > 0) text = t('{{d}}d {{h}}h', { d: days, h: hours });
  else if (hours > 0) text = t('{{h}}h {{m}}m', { h: hours, m: minutes });
  else text = t('{{n}} min', { n: minutes });
  return (
    <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
      <Clock className="size-3.5" />
      {t('Inside {{time}}', { time: text })}
    </span>
  );
}

/** Formats a whole number of minutes as "2h 15m" / "45 min" / "1d 3h" — shared by the live elapsed
 *  label above and the finished-stay label below. */
function formatSpan(t: (key: string, opts?: Record<string, number>) => string, totalMinutes: number) {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  if (days > 0) return t('{{d}}d {{h}}h', { d: days, h: hours });
  if (hours > 0) return t('{{h}}h {{m}}m', { h: hours, m: minutes });
  return t('{{n}} min', { n: minutes });
}

/** How long a vehicle that has already left stayed inside — shown on "Went out recently". */
function StayLabel({ inIso, outIso }: { inIso: string; outIso: string }) {
  const { t } = useTranslation();
  const mins = Math.max(0, (new Date(outIso).getTime() - new Date(inIso).getTime()) / 60_000);
  return (
    <span className="inline-flex items-center gap-1 font-bold text-muted-foreground">
      <Clock className="size-3.5" />
      {t('Stayed {{time}}', { time: formatSpan(t, mins) })}
    </span>
  );
}

/**
 * The gate screen. Built for a guard who may not read much English:
 * one big box to type the number, one big button, then two or three big buttons.
 * A gate login can see nothing else in the society — no money, no dues, no members.
 */
export default function GatePage() {
  const { t, i18n } = useTranslation();
  const { ctx, signOut } = useAuth();
  const qc = useQueryClient();
  const guard = ctx?.guard ?? null;
  const societyId = guard?.society_id ?? '';
  const hindi = i18n.language === 'hi';

  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<GateLookup | null>(null);
  const [flatId, setFlatId] = useState<string | null>(null);
  const [kind, setKind] = useState<GateVehicleKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [outFor, setOutFor] = useState<{ id: string; plate_text: string } | null>(null);
  const [decideFor, setDecideFor] = useState<{ id: string; plate_text: string; decision: 'approve' | 'deny' } | null>(null);
  const [decideNote, setDecideNote] = useState('');
  const [showLog, setShowLog] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  const flats = useQuery({
    queryKey: ['gateFlats', societyId],
    enabled: !!societyId,
    staleTime: 10 * 60_000,
    queryFn: () => rpc<GateFlat[]>('gate_flats', { p_society: societyId }),
  });
  const board = useQuery({
    queryKey: ['gateBoard', societyId],
    enabled: !!societyId,
    // Poll fast while something is waiting on a flat's decision, so the moment they answer shows up
    // here in a few seconds, not up to a minute late — that's what the decision popup below relies on.
    refetchInterval: (q) => ((q.state.data?.awaiting?.length ?? 0) > 0 ? 4_000 : 60_000),
    queryFn: () => rpc<GateBoard>('gate_board', { p_society: societyId }),
  });

  // A resident just decided one of the "waiting" entries from somewhere else (their own phone) —
  // pop a big, unmissable, colour-coded alert so the guard notices even without reading the board.
  // Skipped for anything the guard themselves just decided via the phone-override dialog below.
  const [decisionQueue, setDecisionQueue] = useState<
    { id: string; plate_text: string; unit_name: string | null; decision: 'approved' | 'denied' }[]
  >([]);
  const prevAwaiting = useRef<Set<string>>(new Set());
  const mySelfResolved = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!board.data) return;
    const nowAwaiting = new Set(board.data.awaiting.map((v) => v.id));
    for (const id of prevAwaiting.current) {
      if (nowAwaiting.has(id) || mySelfResolved.current.has(id)) continue;
      const approvedRow = board.data.inside.find((v) => v.id === id);
      if (approvedRow) {
        setDecisionQueue((q) => [
          ...q,
          { id, plate_text: approvedRow.plate_text, unit_name: approvedRow.unit_name, decision: 'approved' },
        ]);
        continue;
      }
      const deniedRow = board.data.recent_out.find((v) => v.id === id && v.approval_status === 'denied');
      if (deniedRow) {
        setDecisionQueue((q) => [
          ...q,
          { id, plate_text: deniedRow.plate_text, unit_name: deniedRow.unit_name, decision: 'denied' },
        ]);
      }
    }
    prevAwaiting.current = nowAwaiting;
  }, [board.data]);
  const popup = decisionQueue[0] ?? null;
  const dismissPopup = () => setDecisionQueue((q) => q.slice(1));

  useEffect(() => {
    box.current?.focus();
  }, []);

  const reset = () => {
    setPlate('');
    setFound(null);
    setFlatId(null);
    setKind(null);
    box.current?.focus();
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gateBoard'] });

  const check = async () => {
    if (plate.replace(/[^A-Z0-9]/g, '').length < 4) return toast.error(t('Type the full vehicle number'));
    setBusy(true);
    try {
      setFound(await rpc<GateLookup>('gate_lookup', { p_society: societyId, p_plate: plate }));
      setFlatId(null);
      setKind(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const markIn = async () => {
    setBusy(true);
    try {
      const res = await rpc<{ approval_status: string }>('gate_check_in', {
        p_society: societyId,
        p_plate: plate,
        p_unit_id: flatId === 'none' ? null : flatId,
        p_note: null,
        p_kind: kind,
      });
      toast.success(
        res.approval_status === 'pending'
          ? t('Sent to the flat for approval. It will not come in until they say yes.')
          : t('Entry saved — IN'),
      );
      nudgePush();
      reset();
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!decideFor) return;
    setBusy(true);
    try {
      await rpc('approve_gate_visit', {
        p_visit_id: decideFor.id,
        p_decision: decideFor.decision,
        p_via: 'guard_override',
        p_note: decideNote,
      });
      mySelfResolved.current.add(decideFor.id);
      toast.success(decideFor.decision === 'approve' ? t('Let in') : t('Kept out'));
      setDecideFor(null);
      setDecideNote('');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const markOut = async (id: string) => {
    setBusy(true);
    try {
      await rpc('gate_check_out', { p_visit_id: id });
      toast.success(t('Marked OUT'));
      setOutFor(null);
      reset();
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const inside = board.data?.inside ?? [];
  const awaiting = board.data?.awaiting ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col bg-background">
      <header className="hero-gradient safe-top sticky top-0 z-30 text-white shadow-md">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <img
            src={brand.logo}
            alt=""
            className="size-9 rounded-[10px] ring-1 ring-white/30"
            width={36}
            height={36}
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[17px] font-extrabold tracking-tight">{t('Gate')}</div>
            <div className="truncate text-[12px] font-medium text-white/80">
              {guard?.society_name} · {ctx?.profile?.full_name}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowLog(true)}
            className="grid size-12 cursor-pointer place-items-center rounded-full hover:bg-white/15"
            aria-label={t('Vehicle log')}
          >
            <History className="size-[22px]" />
          </button>
          <button
            type="button"
            onClick={() => setLanguage(hindi ? 'en' : 'hi')}
            className="grid size-12 cursor-pointer place-items-center rounded-full text-[17px] font-extrabold hover:bg-white/15"
            style={{ fontFamily: 'system-ui, sans-serif' }}
            aria-label={hindi ? 'Switch to English' : 'हिन्दी में बदलें'}
          >
            {hindi ? 'En' : 'अ'}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="grid size-12 cursor-pointer place-items-center rounded-full hover:bg-white/15"
            aria-label={t('Sign out')}
          >
            <LogOut className="size-[22px]" />
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4">
        {/* 1. Type the number */}
        <label htmlFor="gate-plate" className="mb-1.5 block text-[15px] font-bold">
          {t('Vehicle number')}
        </label>
        <input
          id="gate-plate"
          ref={box}
          value={plate}
          onChange={(e) => {
            setPlate(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9 -]/g, '')
                .slice(0, 20),
            );
            setFound(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void check();
          }}
          placeholder="CH01AB1234"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="tabular h-20 w-full rounded-2xl border-2 border-input bg-card px-4 text-center text-[30px] font-extrabold tracking-[0.12em] shadow-sm placeholder:font-semibold placeholder:tracking-normal placeholder:text-muted-foreground/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
        />

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2.5">
          <Button
            size="xl"
            className="h-16 text-[18px]"
            onClick={() => void check()}
            loading={busy && !found}
          >
            <Search className="!size-6" /> {t('Check')}
          </Button>
          <Button
            size="xl"
            variant="outline"
            className="h-16 w-16 p-0"
            onClick={reset}
            aria-label={t('Clear')}
          >
            <RotateCcw className="!size-6" />
          </Button>
        </div>

        {/* 2. The answer */}
        {found && found.resident && (
          <Card className="mt-4 border-2 border-emerald-500/60 bg-emerald-50 p-4 dark:bg-emerald-500/10">
            <div className="flex items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-600 text-white">
                <CheckCircle2 className="size-7" />
              </span>
              <div className="min-w-0">
                <p className="text-[20px] font-extrabold leading-tight text-emerald-900 dark:text-emerald-200">
                  {t('Society vehicle')}
                </p>
                <p className="mt-1 break-words text-[19px] font-extrabold leading-tight">
                  {found.resident.unit_name}
                </p>
                <p className="text-[14px] font-semibold text-muted-foreground">
                  {found.resident.unit_code}
                  {found.resident.model ? ` · ${found.resident.model}` : ''}
                  {found.resident.color ? ` · ${found.resident.color}` : ''}
                </p>
                <p className="mt-2 text-[14px] font-semibold text-emerald-800 dark:text-emerald-300">
                  {t('No entry needed. Let it in.')}
                </p>
              </div>
            </div>
          </Card>
        )}

        {found && !found.resident && found.open_visit && (
          <Card className="mt-4 border-2 border-amber-500/70 bg-amber-50 p-4 dark:bg-amber-400/10">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[20px] font-extrabold leading-tight text-amber-900 dark:text-amber-200">
                {t('Already inside')}
              </p>
              <VehicleKindChip kind={found.open_visit.kind} />
            </div>
            <p className="mt-1.5 text-[15px] font-semibold">
              {t('Came in at')} {dt12(found.open_visit.in_at)}
              {found.open_visit.unit_name ? ` · ${found.open_visit.unit_name}` : ''}
            </p>
            <p className="mt-0.5 text-[14px]">
              <ElapsedLabel iso={found.open_visit.in_at} />
            </p>
            <Button
              size="xl"
              className="mt-3 h-16 w-full bg-amber-600 text-[18px] text-white hover:brightness-110"
              onClick={() => setOutFor({ id: found.open_visit!.id, plate_text: found.plate_text })}
            >
              {t('Mark OUT')}
            </Button>
          </Card>
        )}

        {found && !found.resident && !found.open_visit && (
          <div className="mt-4">
            <Card className="border-2 border-sky-500/60 bg-sky-50 p-4 dark:bg-sky-500/10">
              <p className="text-[20px] font-extrabold leading-tight text-sky-900 dark:text-sky-200">
                {t('Guest vehicle')}
              </p>
              <p className="mt-0.5 text-[14px] font-semibold text-muted-foreground">
                {t('What kind of vehicle is it?')}
              </p>
            </Card>

            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => setKind(opt.kind)}
                  aria-label={t(opt.label)}
                  className={cn(
                    'flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 p-1.5 transition-colors',
                    kind === opt.kind ? 'border-primary bg-primary/10 shadow-lift' : 'border-input bg-card hover:bg-secondary',
                  )}
                >
                  <span className={cn('grid size-10 place-items-center rounded-xl text-white', opt.cls)}>
                    <opt.Icon className="size-[55%]" />
                  </span>
                  <span className="text-[11px] font-bold leading-none">{t(opt.label)}</span>
                </button>
              ))}
            </div>

            <p className="mb-1.5 mt-4 text-[14px] font-semibold text-muted-foreground">
              {t('Which flat is it going to?')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(flats.data ?? []).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFlatId(f.id)}
                  className={cn(
                    'min-h-[72px] cursor-pointer rounded-2xl border-2 p-3 text-left transition-colors',
                    flatId === f.id
                      ? 'border-primary bg-primary text-primary-foreground shadow-lift'
                      : 'border-input bg-card hover:bg-secondary',
                  )}
                >
                  <span className="block break-words text-[15px] font-extrabold leading-tight">{f.name}</span>
                  <span
                    className={cn(
                      'mt-0.5 block text-[12px] font-bold',
                      flatId === f.id ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {f.code}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFlatId('none')}
                className={cn(
                  'col-span-2 min-h-[60px] cursor-pointer rounded-2xl border-2 p-3 text-center text-[15px] font-extrabold transition-colors',
                  flatId === 'none'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-dashed border-input bg-card hover:bg-secondary',
                )}
              >
                {t('Flat not known')}
              </button>
            </div>

            <Button
              size="xl"
              className="mt-3 h-16 w-full text-[18px]"
              disabled={!flatId}
              loading={busy}
              onClick={() => void markIn()}
            >
              {t('Mark IN')}
            </Button>
          </div>
        )}

        {/* Guest vehicles whose flat hasn't answered yet */}
        {awaiting.length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-amber-700 dark:text-amber-400">
              <Hourglass className="size-5" />
              {t('Waiting for the flat to approve')} ({awaiting.length})
            </h2>
            <div className="space-y-2">
              {awaiting.map((v: GateVisitRow) => (
                <Card key={v.id} className="flex items-center gap-3 border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-400/10">
                  <VehicleKindTile kind={v.kind} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="tabular break-words text-[19px] font-extrabold leading-tight tracking-wide">
                        {v.plate_text}
                      </span>
                      <span className="break-words text-[13.5px] font-bold text-muted-foreground">
                        {v.unit_name ?? t('Flat not known')}
                      </span>
                    </p>
                    <p className="mt-1 break-words text-[13px] font-semibold text-muted-foreground">{dt12(v.in_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button
                      size="sm"
                      className="h-10 bg-emerald-600 px-3 text-white hover:brightness-110"
                      onClick={() => {
                        setDecideNote('');
                        setDecideFor({ id: v.id, plate_text: v.plate_text, decision: 'approve' });
                      }}
                    >
                      <PhoneCall className="size-4" /> {t('Approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 px-3"
                      onClick={() => {
                        setDecideNote('');
                        setDecideFor({ id: v.id, plate_text: v.plate_text, decision: 'deny' });
                      }}
                    >
                      <X className="size-4" /> {t('Keep out')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 3. Who is inside right now */}
        <div className="mt-7">
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold">
            <Car className="size-5 text-primary" />
            {t('Inside now')} ({inside.length})
          </h2>
          {inside.length === 0 ? (
            <Card className="p-4 text-center text-[14px] font-semibold text-muted-foreground">
              {t('No guest vehicle inside.')}
            </Card>
          ) : (
            <div className="space-y-2">
              {inside.map((v: GateVisitRow) => (
                <Card key={v.id} className="flex items-center gap-3 p-3">
                  <VehicleKindTile kind={v.kind} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="tabular break-words text-[19px] font-extrabold leading-tight tracking-wide">
                        {v.plate_text}
                      </span>
                      <span className="break-words text-[13.5px] font-bold text-muted-foreground">
                        {v.unit_name ?? t('Flat not known')}
                      </span>
                    </p>
                    <p className="mt-1 break-words text-[13px] font-semibold text-muted-foreground">
                      {dt12(v.in_at)}
                    </p>
                    <p className="mt-0.5 text-[13px]">
                      <ElapsedLabel iso={v.in_at} />
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="h-14 shrink-0 bg-amber-600 px-5 text-[16px] text-white hover:brightness-110"
                    onClick={() => setOutFor({ id: v.id, plate_text: v.plate_text })}
                  >
                    {t('OUT')}
                  </Button>
                </Card>
              ))}
            </div>
          )}
          {(board.data?.recent_out?.length ?? 0) > 0 && (
            <>
              <h2 className="mb-2 mt-6 flex items-center gap-2 text-[14px] font-bold text-muted-foreground">
                <UserRound className="size-4" /> {t('Went out recently')}
              </h2>
              <Card className="divide-y overflow-hidden p-0">
                {(board.data?.recent_out ?? []).map((v) => (
                  <div
                    key={v.id}
                    className={cn(
                      'border-l-4 px-3.5 py-2.5',
                      v.approval_status === 'denied'
                        ? 'border-l-rose-500 bg-rose-50 dark:bg-rose-500/10'
                        : v.approval_status === 'approved'
                          ? 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                          : 'border-l-transparent',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <VehicleKindChip kind={v.kind} />
                        <span className="tabular truncate text-[15px] font-bold tracking-wide">{v.plate_text}</span>
                        {v.approval_status === 'denied' && <Badge variant="danger">{t('Denied')}</Badge>}
                        {v.approval_status === 'approved' && <Badge variant="success">{t('Approved')}</Badge>}
                      </div>
                      <span className="shrink-0 text-right text-[11.5px] font-semibold text-muted-foreground">
                        {dt12(v.in_at)} → {v.out_at ? dt12(v.out_at) : ''}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-[12.5px] font-semibold text-muted-foreground">
                      {v.unit_name ?? t('Flat not known')}
                      {v.unit_code ? ` · ${v.unit_code}` : ''}
                    </p>
                    {v.out_at && (
                      <p className="mt-1 text-[12.5px]">
                        <StayLabel inIso={v.in_at} outIso={v.out_at} />
                      </p>
                    )}
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
      </main>

      <Dialog open={!!outFor} onOpenChange={(o) => !o && setOutFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[20px]">{t('Mark this vehicle OUT?')}</DialogTitle>
          </DialogHeader>
          <p className="tabular text-center text-[26px] font-extrabold tracking-wide">{outFor?.plate_text}</p>
          <DialogFooter>
            <Button size="xl" variant="outline" className="h-14 text-[16px]" onClick={() => setOutFor(null)}>
              {t('No')}
            </Button>
            <Button
              size="xl"
              className="h-14 text-[16px]"
              loading={busy}
              onClick={() => outFor && void markOut(outFor.id)}
            >
              {t('Yes, OUT')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decideFor} onOpenChange={(o) => !o && setDecideFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[20px]">
              {decideFor?.decision === 'approve' ? t('Let this vehicle in?') : t('Keep this vehicle out?')}
            </DialogTitle>
          </DialogHeader>
          <p className="tabular text-center text-[26px] font-extrabold tracking-wide">{decideFor?.plate_text}</p>
          <p className="text-center text-[13px] text-muted-foreground">
            {t('Only do this if the flat is not able to open the app — for example, you already spoke to them on the phone.')}
          </p>
          <Textarea
            value={decideNote}
            onChange={(e) => setDecideNote(e.target.value)}
            placeholder={t('e.g. Spoke to P2-GF on the phone, they said yes')}
            maxLength={200}
            className="min-h-20"
          />
          <DialogFooter>
            <Button size="xl" variant="outline" className="h-14 text-[16px]" onClick={() => setDecideFor(null)}>
              {t('Cancel')}
            </Button>
            <Button
              size="xl"
              className={cn('h-14 text-[16px]', decideFor?.decision === 'approve' ? 'bg-emerald-600 hover:brightness-110' : '')}
              loading={busy}
              disabled={decideNote.trim().length < 3}
              onClick={() => void decide()}
            >
              {decideFor?.decision === 'approve' ? t('Yes, let it in') : t('Yes, keep it out')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Big colour-coded "the flat just decided" alert — green for let-in, red for keep-out. */}
      <Dialog open={!!popup}>
        <DialogContent
          dismissible={false}
          hideClose
          className={cn(
            'border-4 text-center',
            popup?.decision === 'approved'
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15'
              : 'border-rose-500 bg-rose-50 dark:bg-rose-500/15',
          )}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">{t('Flat decision')}</DialogTitle>
          </DialogHeader>
          <span
            className={cn(
              'mx-auto grid size-16 place-items-center rounded-full text-white',
              popup?.decision === 'approved' ? 'bg-emerald-600' : 'bg-rose-600',
            )}
          >
            {popup?.decision === 'approved' ? <CheckCircle2 className="size-9" /> : <X className="size-9" />}
          </span>
          <p
            className={cn(
              'mt-3 text-[22px] font-extrabold leading-tight',
              popup?.decision === 'approved' ? 'text-emerald-900 dark:text-emerald-100' : 'text-rose-900 dark:text-rose-100',
            )}
          >
            {popup?.decision === 'approved' ? t('Approved — let it in!') : t('Kept out — do not let it in')}
          </p>
          <p className="tabular mt-1 text-[26px] font-extrabold tracking-wide">{popup?.plate_text}</p>
          <p className="mt-0.5 text-[15px] font-semibold text-muted-foreground">{popup?.unit_name}</p>
          <Button
            size="xl"
            className={cn(
              'mt-4 h-16 w-full text-[18px]',
              popup?.decision === 'approved' ? 'bg-emerald-600 hover:brightness-110' : 'bg-rose-600 hover:brightness-110',
            )}
            onClick={dismissPopup}
          >
            {t('OK')}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showLog} onOpenChange={setShowLog}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[20px]">{t('Vehicle log')}</DialogTitle>
          </DialogHeader>
          {showLog && <GateVisitLogList societyId={societyId} showUnitFilter={false} compact />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
