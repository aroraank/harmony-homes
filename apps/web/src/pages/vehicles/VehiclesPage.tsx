import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bike, Car, Pencil, PieChart as PieChartIcon, Plus, Search, Trash2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useUnits } from '@/lib/queries';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { UnitSelect } from '@/components/UnitSelect';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { StatTile } from '@/components/StatTile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { VehicleKind, VehicleRow } from '@/types';

export function useVehicles(societyId: string) {
  return useQuery({
    queryKey: ['vehicles', societyId],
    queryFn: () => rpc<VehicleRow[]>('vehicle_directory', { p_society: societyId }),
  });
}

export const KIND_LABELS: Record<VehicleKind, string> = {
  car: 'Car',
  bike: 'Motorcycle',
  scooter: 'Scooter',
  other: 'Other',
};

export function KindIcon({ kind, className }: { kind: VehicleKind; className?: string }) {
  return kind === 'car' || kind === 'other' ? <Car className={className} /> : <Bike className={className} />;
}

type Form = {
  open: boolean;
  id: string | null;
  unit_id: string;
  plate: string;
  kind: VehicleKind;
  model: string;
  color: string;
};

/** Everyone's vehicles. Any member can look up a number to find out which flat it belongs to. */
export default function VehiclesPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const loc = useLocation();
  const nav = useNavigate();
  const list = useVehicles(m.societyId);
  const units = useUnits(m.societyId);
  const [tab, setTab] = useState('directory');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [removing, setRemoving] = useState<VehicleRow | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const mine = all.filter((v) => v.unit_id === m.unit_id);
  const q = search.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const matches = q
    ? all.filter(
        (v) =>
          v.plate.includes(q) ||
          `${v.unit_code}${v.unit_name}${v.model ?? ''}`
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase()
            .includes(q),
      )
    : all;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['vehicles'] });

  const openAdd = () =>
    setForm({ open: true, id: null, unit_id: m.unit_id ?? '', plate: '', kind: 'car', model: '', color: '' });

  // Arriving here from the "Add my vehicle" popup — open the add form right away so the member
  // doesn't have to tap "Add" a second time. Clears the nav state afterwards so a back/forward
  // visit, or a refresh, doesn't reopen it.
  useEffect(() => {
    const state = loc.state as { autoOpenAdd?: boolean } | null;
    if (state?.autoOpenAdd) {
      setForm({ open: true, id: null, unit_id: m.unit_id ?? '', plate: '', kind: 'car', model: '', color: '' });
      nav(loc.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openEdit = (v: VehicleRow) =>
    setForm({
      open: true,
      id: v.id,
      unit_id: v.unit_id,
      plate: v.plate_text,
      kind: v.kind,
      model: v.model ?? '',
      color: v.color ?? '',
    });

  const save = async () => {
    if (!form) return;
    if (!form.unit_id) return toast.error(t('Choose a flat.'));
    if (form.plate.replace(/[^A-Za-z0-9]/g, '').length < 4)
      return toast.error(t('Enter the full vehicle number.'));
    setBusy(true);
    try {
      if (form.id) {
        await rpc('update_vehicle', {
          p_vehicle_id: form.id,
          p_plate: form.plate,
          p_kind: form.kind,
          p_model: form.model || null,
          p_color: form.color || null,
        });
      } else {
        await rpc('add_vehicle', {
          p_society: m.societyId,
          p_unit_id: form.unit_id,
          p_plate: form.plate,
          p_kind: form.kind,
          p_model: form.model || null,
          p_color: form.color || null,
        });
      }
      toast.success(form.id ? t('Vehicle updated') : t('Vehicle added'));
      setForm(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await rpc('remove_vehicle', { p_vehicle_id: removing.id });
      toast.success(t('Vehicle removed'));
      setRemoving(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const directory = (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Search number or flat')}
          autoCapitalize="characters"
          className="pl-10"
          aria-label={t('Search number or flat')}
        />
      </div>

      {!search && m.unit_id && (
        <>
          <SectionTitle>{t('My vehicles')}</SectionTitle>
          {mine.length === 0 ? (
            <Card className="p-4">
              <p className="text-[14px] font-semibold">{t('You have not added any vehicle yet.')}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t('Add your car, scooter or motorcycle so neighbours and the guard can identify it.')}
              </p>
              <Button className="mt-3 w-full" onClick={openAdd}>
                <Plus /> {t('Add my vehicle')}
              </Button>
            </Card>
          ) : (
            <div className="space-y-2">
              {mine.map((v) => (
                <Row key={v.id} v={v} onEdit={() => openEdit(v)} onRemove={() => setRemoving(v)} />
              ))}
            </div>
          )}
        </>
      )}

      <SectionTitle>{search ? t('Results') : t('All vehicles in the society')}</SectionTitle>
      <QueryState
        query={list}
        empty={(d) =>
          d.length === 0 ? (
            <EmptyState
              icon={<Car className="size-7" />}
              title={t('No vehicles added yet')}
              hint={t('Each flat can add its own vehicles.')}
            />
          ) : matches.length === 0 ? (
            <EmptyState icon={<Search className="size-7" />} title={t('No vehicle matches that')} />
          ) : null
        }
      >
        {() => (
          <div className="space-y-2">
            {matches.map((v) => (
              <Row key={v.id} v={v} showOwner onEdit={() => openEdit(v)} onRemove={() => setRemoving(v)} />
            ))}
          </div>
        )}
      </QueryState>
    </>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Vehicles')}
        subtitle={t('Find out whose vehicle it is, and keep your own up to date.')}
        back
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus /> {t('Add')}
          </Button>
        }
      />

      {m.isAdmin ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="directory">{t('Directory')}</TabsTrigger>
            <TabsTrigger value="reports">{t('Reports')}</TabsTrigger>
          </TabsList>
          <TabsContent value="directory">{directory}</TabsContent>
          <TabsContent value="reports">
            <VehicleReports vehicles={all} totalUnits={units.data?.length ?? 0} loading={list.isLoading} />
          </TabsContent>
        </Tabs>
      ) : (
        directory
      )}

      {form && (
        <Dialog open onOpenChange={(o) => !o && setForm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.id ? t('Edit vehicle') : t('Add vehicle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {m.isAdmin && !form.id && (
                <Field label={t('Flat')}>
                  <UnitSelect
                    units={units.data ?? []}
                    value={form.unit_id}
                    onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                  />
                </Field>
              )}
              <Field label={t('Vehicle number')} hint={t('For example CH01AB1234')}>
                <Input
                  value={form.plate}
                  maxLength={20}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="tabular text-[19px] font-bold tracking-wider"
                  onChange={(e) =>
                    setForm({ ...form, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, '') })
                  }
                />
              </Field>
              <Field label={t('Type')}>
                <NativeSelect
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as VehicleKind })}
                >
                  <option value="car">{t('Car')}</option>
                  <option value="scooter">{t('Scooter')}</option>
                  <option value="bike">{t('Motorcycle')}</option>
                  <option value="other">{t('Other')}</option>
                </NativeSelect>
              </Field>
              <Field label={t('Model name')} hint={t('For example Verna, Thar, Activa')} optional>
                <Input
                  value={form.model}
                  maxLength={30}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </Field>
              <Field label={t('Colour')} optional>
                <Input
                  value={form.color}
                  maxLength={20}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>
                {t('Cancel')}
              </Button>
              <Button onClick={() => void save()} loading={busy}>
                {form.id ? t('Save') : t('Add vehicle')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmSheet
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('Remove this vehicle?')}
        description={removing?.plate_text}
        confirmLabel={t('Remove')}
        destructive
        loading={busy}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function Row({
  v,
  showOwner,
  onEdit,
  onRemove,
}: {
  v: VehicleRow;
  showOwner?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
        <KindIcon kind={v.kind} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tabular break-words text-[17px] font-extrabold leading-tight tracking-wide">
          {v.plate_text}
        </p>
        <p className="break-words text-[13px] font-semibold text-muted-foreground">
          {[v.model, v.color].filter(Boolean).join(' · ') || t(KIND_LABELS[v.kind])}
        </p>
        {showOwner && (
          <p className="mt-0.5 break-words text-[12.5px] text-muted-foreground">
            {v.unit_name}
            {v.owner_name ? ` · ${v.owner_name}` : ''}
          </p>
        )}
      </div>
      {!showOwner && <Badge variant="secondary">{v.unit_code}</Badge>}
      {v.can_edit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t('Edit')}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t('Remove')}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      )}
    </Card>
  );
}

function CountTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { code?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-[12.5px] shadow-lg">
      {(label || payload[0]?.payload?.code) && (
        <p className="mb-1 font-semibold">{label ?? payload[0]?.payload?.code}</p>
      )}
      {payload.map((p, i) => (
        <p key={p.name ?? i} className="tabular flex items-center gap-2">
          {p.color && <span className="inline-block size-2.5 rounded-full" style={{ background: p.color }} />}
          {p.name ? `${p.name}: ` : ''}
          <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
}

/** Admin/super-admin only: how many of each kind, and which flats have more or fewer. */
function VehicleReports({
  vehicles,
  totalUnits,
  loading,
}: {
  vehicles: VehicleRow[];
  totalUnits: number;
  loading: boolean;
}) {
  const { t } = useTranslation();

  const byKind = { car: 0, two: 0, other: 0 };
  for (const v of vehicles) {
    if (v.kind === 'car') byKind.car++;
    else if (v.kind === 'bike' || v.kind === 'scooter') byKind.two++;
    else byKind.other++;
  }
  const pieData = [
    { name: t('Cars'), value: byKind.car, color: '#10b981' },
    { name: t('Motorcycles & scooters'), value: byKind.two, color: '#0ea5e9' },
    { name: t('Other'), value: byKind.other, color: '#94a3b8' },
  ].filter((d) => d.value > 0);

  const perFlat = new Map<string, number>();
  for (const v of vehicles) perFlat.set(v.unit_code, (perFlat.get(v.unit_code) ?? 0) + 1);
  const barData = [...perFlat.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const flatsWithVehicle = perFlat.size;
  const flatsWithNone = Math.max(0, totalUnits - flatsWithVehicle);
  const top = barData[0];
  const axis = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

  if (loading) return null;
  if (vehicles.length === 0) {
    return (
      <EmptyState
        icon={<PieChartIcon className="size-7" />}
        title={t('No vehicles added yet')}
        hint={t('Charts will appear once flats start adding their vehicles.')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label={t('Total vehicles')} value={vehicles.length} icon={<Car />} />
        <StatTile
          label={t('Flats with a vehicle')}
          value={totalUnits ? `${flatsWithVehicle} / ${totalUnits}` : flatsWithVehicle}
        />
        <StatTile
          label={t('Most vehicles at one flat')}
          value={top ? `${top.count}` : '—'}
          hint={top?.code}
        />
        <StatTile
          label={t('Flats with no vehicle')}
          value={flatsWithNone}
          tone={flatsWithNone > 0 ? 'warn' : 'default'}
        />
      </div>

      <Card className="p-3 pt-4">
        <p className="mb-1 px-1 text-sm font-bold">{t('By vehicle type')}</p>
        <div
          className="h-64"
          role="img"
          aria-label={t('Donut chart of cars versus motorcycles and scooters')}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="85%"
                paddingAngle={2}
              >
                {pieData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={<CountTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 px-2">
          {pieData.map((d) => (
            <span key={d.name} className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <span className="inline-block size-2.5 rounded-full" style={{ background: d.color }} />
              {d.name} · <span className="tabular">{d.value}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card className="p-3 pt-4">
        <p className="mb-2 px-1 text-sm font-bold">{t('Vehicles by flat (most to least)')}</p>
        <div
          className="w-full"
          style={{ height: Math.max(220, barData.length * 30) }}
          role="img"
          aria-label={t('Bar chart of how many vehicles each flat has')}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical" margin={{ left: 4, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
              <YAxis
                dataKey="code"
                type="category"
                tick={axis}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip content={<CountTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
              <Bar
                dataKey="count"
                name={t('Vehicles')}
                fill="#10b981"
                radius={[0, 6, 6, 0]}
                maxBarSize={18}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
