import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  Check,
  Clock,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MOBILE_RE, normalizeMobile } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useContactCategories } from '@/lib/queries';
import { cn, whatsappLink } from '@/lib/utils';
import { PhoneInput } from '@/components/PhoneInput';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmSheet } from '@/components/ConfirmSheet';

export type DirContact = {
  id: string;
  category_id: string;
  category: string;
  name: string;
  phones: string[];
  whatsapp: boolean;
  notes: string | null;
  timings: string | null;
  typical_rate: string | null;
  status: 'active' | 'suggested';
  added_by: string | null;
  added_by_label: string | null;
  added_at: string;
  can_edit: boolean;
};
type Committee = {
  user_id: string;
  role: string;
  profiles: { full_name: string; phone: string | null } | null;
};
type Form = {
  open: boolean;
  id: string | null;
  category_id: string;
  name: string;
  phones: string[];
  whatsapp: boolean;
  notes: string;
  timings: string;
  rate: string;
};
const EMPTY: Form = {
  open: false,
  id: null,
  category_id: '',
  name: '',
  phones: [''],
  whatsapp: true,
  notes: '',
  timings: '',
  rate: '',
};
const MAX_PHONES = 5;

export function useDirectory(societyId: string) {
  return useQuery({
    queryKey: ['contacts', societyId],
    queryFn: () => rpc<DirContact[]>('contact_directory', { p_society: societyId }),
  });
}

/** Society directory of plumbers, electricians etc. Any member can add; each entry shows who added it. */
export default function ContactsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const cats = useContactCategories(m.societyId);
  const dir = useDirectory(m.societyId);
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [form, setForm] = useState<Form>(EMPTY);
  const [catForm, setCatForm] = useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const [removing, setRemoving] = useState<DirContact | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = m.can('manage_contacts');

  const committee = useQuery({
    queryKey: ['committee', m.societyId],
    queryFn: async () =>
      unwrap<Committee[]>(
        await supabase
          .from('memberships')
          .select('user_id, role, profiles!memberships_user_id_fkey(full_name, phone)')
          .eq('society_id', m.societyId)
          .eq('status', 'active')
          .in('role', ['admin', 'super_admin']),
      ),
  });

  const all = useMemo(() => dir.data ?? [], [dir.data]);
  const tagCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of all) if (x.status === 'active') c.set(x.category_id, (c.get(x.category_id) ?? 0) + 1);
    return c;
  }, [all]);
  const shownCats = (cats.data ?? []).filter((c) => tagCounts.has(c.id) || c.id === category);
  const q = search.trim().toLowerCase();
  const list = all.filter(
    (c) =>
      c.status === 'active' &&
      (!category || c.category_id === category) &&
      (!q ||
        `${c.name} ${c.phones.join(' ')} ${c.notes ?? ''} ${c.category} ${c.added_by_label ?? ''}`
          .toLowerCase()
          .includes(q)),
  );
  const suggestions = all.filter((c) => c.status === 'suggested');

  const refresh = () => void qc.invalidateQueries({ queryKey: ['contacts'] });

  const openAdd = () => setForm({ ...EMPTY, open: true, category_id: category });
  const openEdit = (c: DirContact) =>
    setForm({
      open: true,
      id: c.id,
      category_id: c.category_id,
      name: c.name,
      phones: c.phones.length ? c.phones : [''],
      whatsapp: c.whatsapp,
      notes: c.notes ?? '',
      timings: c.timings ?? '',
      rate: c.typical_rate ?? '',
    });

  const save = async () => {
    const phones = form.phones.map((p) => normalizeMobile(p)).filter(Boolean);
    if (!form.category_id) return toast.error(t('Choose a job tag'));
    if (form.name.trim().length < 2) return toast.error(t('Name must be 2–60 characters.'));
    if (phones.length === 0) return toast.error(t('Add at least one phone number.'));
    if (phones.some((p) => !MOBILE_RE.test(p))) return toast.error(t('Enter valid 10-digit mobile numbers'));
    if (new Set(phones).size !== phones.length) return toast.error(t('The same number is entered twice'));
    setBusy(true);
    try {
      const args = {
        p_category_id: form.category_id,
        p_name: form.name,
        p_phones: phones,
        p_notes: form.notes || null,
        p_timings: form.timings || null,
        p_typical_rate: form.rate || null,
        p_whatsapp: form.whatsapp,
      };
      if (form.id) await rpc('update_contact', { p_contact_id: form.id, ...args });
      else await rpc('add_contact', { p_society: m.societyId, ...args });
      toast.success(form.id ? t('Contact updated') : t('Contact added'));
      setForm(EMPTY);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try {
      await rpc(fn, args);
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await rpc('archive_contact', { p_contact_id: removing.id });
      toast.success(t('Contact removed'));
      setRemoving(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    try {
      const id = await rpc<string>('upsert_contact_category', {
        p_society: m.societyId,
        p_id: null,
        p_name: catForm.name,
        p_sort_order: 50,
        p_is_pinned: false,
      });
      await qc.invalidateQueries({ queryKey: ['contactCategories'] });
      setForm((f) => ({ ...f, category_id: id }));
      setCatForm({ open: false, name: '' });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Important numbers')}
        subtitle={t('Plumber, electrician, tank cleaner and more, added by members')}
        back="/more"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus /> {t('Add')}
          </Button>
        }
      />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Search name, job or number')}
          className="pl-10"
          aria-label={t('Search')}
        />
      </div>
      <div className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        <TagChip active={!category} onClick={() => setCategory('')}>
          {t('All')} · {all.filter((c) => c.status === 'active').length}
        </TagChip>
        {shownCats.map((c) => (
          <TagChip
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(category === c.id ? '' : c.id)}
          >
            {t(c.name)} · {tagCounts.get(c.id) ?? 0}
          </TagChip>
        ))}
      </div>

      {!category && !q && (committee.data ?? []).length > 0 && (
        <>
          <SectionTitle>{t('Admins / committee')}</SectionTitle>
          <div className="space-y-2">
            {committee.data!.map((a) => (
              <ContactCard
                key={a.user_id}
                name={a.profiles?.full_name ?? ''}
                phones={a.profiles?.phone ? [a.profiles.phone] : []}
                whatsapp
                tag={a.role === 'super_admin' ? t('Super admin') : t('Admin')}
                icon={<ShieldCheck className="size-5" />}
              />
            ))}
          </div>
        </>
      )}

      {suggestions.length > 0 && (
        <>
          <SectionTitle>{canManage ? t('Suggestions to review') : t('Your suggestions')}</SectionTitle>
          <div className="space-y-2">
            {suggestions.map((c) => (
              <Card key={c.id} className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="tabular truncate text-[12.5px] text-muted-foreground">
                      {t(c.category)} · {c.phones.join(', ')}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1.5">
                      <Button
                        size="icon-sm"
                        onClick={() =>
                          act(
                            'review_contact',
                            { p_contact_id: c.id, p_approve: true },
                            t('Contact approved'),
                          )
                        }
                        aria-label={t('Approve')}
                      >
                        <Check />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() =>
                          act(
                            'review_contact',
                            { p_contact_id: c.id, p_approve: false },
                            t('Suggestion rejected'),
                          )
                        }
                        aria-label={t('Reject')}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="warning">
                      <Clock className="size-3.5" /> {t('Waiting for approval')}
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle>{q || category ? t('Results') : t('Everyone, A to Z')}</SectionTitle>
      <QueryState
        query={dir}
        empty={() =>
          list.length ? null : (
            <EmptyState
              icon={<Phone className="size-7" />}
              title={q || category ? t('No matching contact') : t('No contacts yet')}
              hint={t('Add a plumber, electrician or tank cleaner you trust, so neighbours can find them.')}
            />
          )
        }
      >
        {() => (
          <div className="space-y-2">
            {list.map((c) => (
              <ContactCard
                key={c.id}
                name={c.name}
                phones={c.phones}
                whatsapp={c.whatsapp}
                tag={t(c.category)}
                sub={[c.timings, c.typical_rate, c.notes].filter(Boolean).join(' · ')}
                addedBy={c.added_by_label}
                actions={
                  c.can_edit && (
                    <>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(c)}
                        aria-label={t('Edit')}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setRemoving(c)}
                        aria-label={t('Remove')}
                      >
                        <Archive />
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </div>
        )}
      </QueryState>

      <Dialog open={form.open} onOpenChange={(o) => !o && !busy && setForm(EMPTY)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? t('Edit contact') : t('Add contact')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('Job (choose one)')}>
              <div>
                <div className="flex flex-wrap gap-2">
                  {(cats.data ?? []).map((c) => (
                    <TagChip
                      key={c.id}
                      active={form.category_id === c.id}
                      onClick={() => setForm((f) => ({ ...f, category_id: c.id }))}
                    >
                      {t(c.name)}
                    </TagChip>
                  ))}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setCatForm({ open: true, name: '' })}
                      className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 text-[13px] font-semibold text-primary"
                    >
                      <Plus className="size-4" /> {t('New job')}
                    </button>
                  )}
                </div>
                {!canManage && (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    {t('Pick the closest job. Choose Other if none fits; an admin can add new jobs.')}
                  </p>
                )}
              </div>
            </Field>
            <Field label={t('Name')}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={60}
              />
            </Field>
            <Field label={t('Phone number(s)')}>
              <div className="space-y-2">
                {form.phones.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="flex-1">
                      <PhoneInput
                        value={p}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            phones: f.phones.map((x, j) => (j === i ? e.target.value : x)),
                          }))
                        }
                        placeholder={i === 0 ? t('Main number') : t('Another number')}
                      />
                    </div>
                    {form.phones.length > 1 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setForm((f) => ({ ...f, phones: f.phones.filter((_, j) => j !== i) }))}
                        aria-label={t('Remove number')}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
                {form.phones.length < MAX_PHONES && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, phones: [...f.phones, ''] }))}
                  >
                    <Plus /> {t('Add another number')}
                  </Button>
                )}
              </div>
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center justify-between">
              <span className="text-sm font-semibold">{t('Main number is on WhatsApp')}</span>
              <Switch
                checked={form.whatsapp}
                onCheckedChange={(v) => setForm((f) => ({ ...f, whatsapp: v }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Timings')} optional>
                <Input
                  value={form.timings}
                  onChange={(e) => setForm((f) => ({ ...f, timings: e.target.value }))}
                  maxLength={80}
                  placeholder="9am–7pm"
                />
              </Field>
              <Field label={t('Typical rate')} optional>
                <Input
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                  maxLength={80}
                  placeholder="₹300/visit"
                />
              </Field>
            </div>
            <Field label={t('Your experience / notes')} optional>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                maxLength={300}
                placeholder={t('e.g. Did our tank cleaning, on time and tidy')}
              />
            </Field>
            {!form.id && (
              <p className="text-[12px] text-muted-foreground">
                {t('Your name and flat are shown with this contact so neighbours can ask you about them.')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(EMPTY)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={busy}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catForm.open} onOpenChange={(o) => setCatForm((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('New job')}</DialogTitle>
          </DialogHeader>
          <Field label={t('Name')}>
            <Input
              value={catForm.name}
              onChange={(e) => setCatForm((s) => ({ ...s, name: e.target.value }))}
              maxLength={40}
            />
          </Field>
          <p className="text-[12px] text-muted-foreground">
            {t('Check the list first so the same job is not added twice, for example Plumber and Plumberr.')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatForm({ open: false, name: '' })}>
              {t('Cancel')}
            </Button>
            <Button onClick={addCategory} disabled={catForm.name.trim().length < 2}>
              {t('Add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmSheet
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('Remove this contact?')}
        description={removing ? t('{{n}} will no longer show in the directory.', { n: removing.name }) : ''}
        confirmLabel={t('Remove')}
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}

function TagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-bold transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card text-muted-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  );
}

function ContactCard({
  name,
  phones,
  whatsapp,
  tag,
  sub,
  addedBy,
  icon,
  actions,
}: {
  name: string;
  phones: string[];
  whatsapp?: boolean;
  tag?: string;
  sub?: string;
  addedBy?: string | null;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
          {icon ?? <UserRound className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-semibold">{name}</p>
            {tag && <Badge variant="lime">{tag}</Badge>}
          </div>
          {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
          {addedBy && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Added by {{n}}', { n: addedBy })}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      {phones.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">{t('No phone added')}</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {phones.map((p, i) => (
            <div key={p} className="flex items-center gap-1">
              <Button asChild size="sm" aria-label={t('Call {{n}}', { n: p })}>
                <a href={`tel:+91${p}`}>
                  <Phone /> <span className="tabular">{p}</span>
                </a>
              </Button>
              {i === 0 && whatsapp && (
                <Button
                  asChild
                  size="icon-sm"
                  variant="outline"
                  aria-label={t('WhatsApp {{n}}', { n: name })}
                >
                  <a href={whatsappLink(p)} target="_blank" rel="noopener noreferrer">
                    <MessageCircle />
                  </a>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
