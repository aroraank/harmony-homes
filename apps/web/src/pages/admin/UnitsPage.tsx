import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, Pencil, Plus, Search, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR, paiseToInput, parseRupeesToPaise } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useSettings, useUnitTypes, useUnits } from '@/lib/queries';
import { generateUnits, type GeneratedUnit } from '@/lib/unitGenerator';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Unit, UnitType } from '@/types';

export default function UnitsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const units = useUnits(m.societyId);
  const types = useUnitTypes(m.societyId);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Unit | null>(null);
  const [typeEdit, setTypeEdit] = useState<(Partial<UnitType> & { open: boolean; amount: string }) | null>(null);
  const typeName = useMemo(() => Object.fromEntries((types.data ?? []).map((x) => [x.id, x.name])), [types.data]);

  if (!m.can('manage_units')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const list = (units.data ?? []).filter((u) => !search || `${u.code} ${u.display_name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Flats & blocks')} subtitle={t('{{n}} units', { n: units.data?.length ?? 0 })} back="/more" />
      <Tabs defaultValue="units">
        <TabsList>
          <TabsTrigger value="units">{t('Units')}</TabsTrigger>
          <TabsTrigger value="types">{t('Flat types')}</TabsTrigger>
          <TabsTrigger value="generate">{t('Bulk add')}</TabsTrigger>
        </TabsList>
        <TabsContent value="units">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search code or name')} className="pl-10" />
          </div>
          <QueryState query={units} empty={(d) => (d.length ? null : <EmptyState icon={<Building2 className="size-7" />} title={t('No units yet')} hint={t('Use “Bulk add” to create them.')} />)}>
            {() => (
              <Card className="divide-y">
                {list.map((u) => (
                  <button key={u.id} type="button" onClick={() => setEdit(u)} className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-secondary/50">
                    <span className="tabular w-20 font-bold">{u.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{u.display_name}</span>
                    <Badge variant="secondary">{typeName[u.unit_type_id]}</Badge>
                    {u.status === 'vacant' && <Badge variant="muted">{t('Vacant')}</Badge>}
                    {!u.is_billable && <Badge variant="warning">{t('Not billed')}</Badge>}
                    <Pencil className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </Card>
            )}
          </QueryState>
        </TabsContent>
        <TabsContent value="types">
          <Card className="divide-y">
            {types.data?.map((ty) => (
              <button
                key={ty.id}
                type="button"
                onClick={() => setTypeEdit({ ...ty, open: true, amount: paiseToInput(ty.monthly_due_paise) })}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between px-4 text-left hover:bg-secondary/50"
              >
                <span className="font-semibold">{ty.name}</span>
                <span className="text-sm text-muted-foreground">{ty.monthly_due_paise ? formatINR(ty.monthly_due_paise) + ' / ' + t('month') : t('Uses society default')}</span>
              </button>
            ))}
          </Card>
          <Button variant="outline" className="mt-3 w-full" onClick={() => setTypeEdit({ open: true, amount: '' })}>
            <Plus /> {t('Add flat type')}
          </Button>
        </TabsContent>
        <TabsContent value="generate">
          <Generator types={types.data ?? []} existing={units.data ?? []} />
        </TabsContent>
      </Tabs>
      {edit && <UnitEdit unit={edit} types={types.data ?? []} onClose={() => setEdit(null)} />}
      {typeEdit && <TypeEdit value={typeEdit} onClose={() => setTypeEdit(null)} />}
    </div>
  );
}

function UnitEdit({ unit, types, onClose }: { unit: Unit; types: UnitType[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(unit.display_name);
  const [type, setType] = useState(unit.unit_type_id);
  const [status, setStatus] = useState(unit.status);
  const [billable, setBillable] = useState(unit.is_billable);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await rpc('update_unit', { p_unit_id: unit.id, p_display_name: name, p_unit_type_id: type, p_status: status, p_is_billable: billable });
      void qc.invalidateQueries({ queryKey: ['units'] });
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
          <DialogTitle>{unit.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted-foreground">{t('The unit code is also the login username, so it cannot be changed.')}</p>
          <Field label={t('Display name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('Flat type')}>
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('Status')}>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as Unit['status'])}>
              <option value="occupied">{t('Occupied')}</option>
              <option value="vacant">{t('Vacant')}</option>
            </NativeSelect>
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">{t('Billable')}</span>
              <span className="block text-[12.5px] text-muted-foreground">{t('Gets monthly maintenance dues')}</span>
            </span>
            <Switch checked={billable} onCheckedChange={setBillable} />
          </label>
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

function TypeEdit({ value, onClose }: { value: Partial<UnitType> & { amount: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [name, setName] = useState(value.name ?? '');
  const [amount, setAmount] = useState(value.amount);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const paise = amount.trim() ? parseRupeesToPaise(amount) : null;
    if (amount.trim() && !paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    setBusy(true);
    try {
      await rpc('upsert_unit_type', { p_society: m.societyId, p_id: value.id ?? null, p_name: name, p_monthly_due_paise: paise, p_sort_order: value.sort_order ?? 10 });
      void qc.invalidateQueries({ queryKey: ['unitTypes'] });
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
          <DialogTitle>{value.id ? t('Edit flat type') : t('Add flat type')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="3BHK" />
          </Field>
          <Field label={t('Monthly maintenance for this type')} optional hint={t('Leave empty to use the society default amount')}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={busy} disabled={!name.trim()}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Generator({ types, existing }: { types: UnitType[]; existing: Unit[] }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const settings = useSettings(m.societyId);
  const [blocks, setBlocks] = useState('A');
  const [floors, setFloors] = useState('1-4');
  const [perFloor, setPerFloor] = useState('4');
  const [codePattern, setCodePattern] = useState('{B}-{F}{N}');
  const [namePattern, setNamePattern] = useState('Block {B}, Flat {F}{N}');
  const [blockNamePattern, setBlockNamePattern] = useState('Block {B}');
  const [typeId, setTypeId] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  let preview: GeneratedUnit[] = [];
  let error: string | null = null;
  try {
    preview = typeId ? generateUnits({ blocks, floors, perFloor: Number(perFloor), codePattern, namePattern, blockNamePattern, unitTypeId: typeId }, existing.length) : [];
  } catch (e) {
    error = (e as Error).message;
  }
  const codes = new Set(existing.map((u) => u.code));
  const clashes = preview.filter((u) => codes.has(u.code));
  const dupes = preview.filter((u, i) => preview.findIndex((x) => x.code === u.code) !== i);
  const invalid = preview.filter((u) => !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(u.code));

  const create = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ created: number }>('create_units_bulk', { p_society: m.societyId, p_units: preview });
      toast.success(t('{{n}} units created', { n: r.created }));
      void qc.invalidateQueries({ queryKey: ['units'] });
      setConfirm(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => (setBlocks('1-6, 9-12'), setFloors('GF,FF,SF'), setPerFloor('1'), setCodePattern('P{B}-{F}'), setNamePattern('Plot {B}, {FN}'), setBlockNamePattern('Plot {B}'))}>
          {t('Plot style')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => (setBlocks('A'), setFloors('1-18'), setPerFloor('10'), setCodePattern('{B}-{F}{N}'), setNamePattern('Block {B}, Flat {F}{N}'), setBlockNamePattern('Block {B}'))}>
          {t('Tower style')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Blocks / plots')} hint="A-C or 1-6, 9-12">
          <Input value={blocks} onChange={(e) => setBlocks(e.target.value)} />
        </Field>
        <Field label={t('Floors')} hint="GF,FF,SF or 1-18">
          <Input value={floors} onChange={(e) => setFloors(e.target.value)} />
        </Field>
        <Field label={t('Units per floor')}>
          <Input type="number" min={1} max={50} value={perFloor} onChange={(e) => setPerFloor(e.target.value)} />
        </Field>
        <Field label={t('Flat type')}>
          <NativeSelect value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label={t('Code pattern')} hint={t('{B} block, {F} floor, {N} unit 01, {n} unit 1')}>
        <Input value={codePattern} onChange={(e) => setCodePattern(e.target.value)} className="font-mono" />
      </Field>
      <Field label={t('Name pattern')} hint={t('{FN} gives “Ground Floor”, “Floor 18”…')}>
        <Input value={namePattern} onChange={(e) => setNamePattern(e.target.value)} />
      </Field>
      <Field label={t('Block name pattern')}>
        <Input value={blockNamePattern} onChange={(e) => setBlockNamePattern(e.target.value)} />
      </Field>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {preview.length > 0 && (
        <div className="rounded-2xl border bg-muted/40 p-3">
          <p className="mb-2 text-sm font-semibold">{t('Preview: {{n}} units', { n: preview.length })}</p>
          <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto text-[12.5px]">
            {preview.slice(0, 60).map((u, i) => (
              <p key={i} className={codes.has(u.code) ? 'text-destructive' : ''}>
                <strong className="tabular">{u.code}</strong> · {u.display_name}
              </p>
            ))}
          </div>
          {preview.length > 60 && <p className="mt-1 text-[12px] text-muted-foreground">{t('…and {{n}} more', { n: preview.length - 60 })}</p>}
          {(clashes.length > 0 || dupes.length > 0 || invalid.length > 0) && (
            <p className="mt-2 text-[12.5px] font-semibold text-destructive">
              {clashes.length > 0 && t('{{n}} codes already exist. ', { n: clashes.length })}
              {dupes.length > 0 && t('{{n}} codes repeat. ', { n: dupes.length })}
              {invalid.length > 0 && t('{{n}} codes are invalid.', { n: invalid.length })}
            </p>
          )}
        </div>
      )}
      <p className="text-[12.5px] text-muted-foreground">
        {t('New units are billable and get the default monthly due of {{a}} unless their type has its own amount.', { a: formatINR(settings.data?.monthly_due_paise ?? 0) })}
      </p>
      <Button className="w-full" disabled={!preview.length || clashes.length > 0 || dupes.length > 0 || invalid.length > 0 || preview.length > 2000} onClick={() => setConfirm(true)}>
        <Wand2 /> {t('Create {{n}} units', { n: preview.length })}
      </Button>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Create {{n}} units?', { n: preview.length })}
        description={t('Unit codes become login usernames and cannot be changed later.')}
        confirmLabel={t('Create units')}
        loading={busy}
        onConfirm={create}
      />
    </Card>
  );
}

