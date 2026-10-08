import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Archive, Check, Clock, MessageCircle, Pencil, Phone, Plus, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { MOBILE_RE, normalizeMobile } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useContactCategories } from '@/lib/queries';
import { whatsappLink } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Contact } from '@/types';

type Committee = { user_id: string; role: string; profiles: { full_name: string; phone: string | null } | null };
type Form = Partial<Contact> & { open: boolean; mode: 'add' | 'edit' | 'suggest' };

export default function ContactsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const cats = useContactCategories(m.societyId);
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form>({ open: false, mode: 'add' });
  const [catForm, setCatForm] = useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const [busy, setBusy] = useState(false);
  const canManage = m.can('manage_contacts');

  const contacts = useQuery({
    queryKey: ['contacts', m.societyId],
    queryFn: async () => unwrap<Contact[]>(await supabase.from('contacts').select('*').eq('society_id', m.societyId).in('status', ['active', 'suggested']).order('name')),
  });
  const committee = useQuery({
    queryKey: ['committee', m.societyId],
    queryFn: async () =>
      unwrap<Committee[]>(
        await supabase.from('memberships').select('user_id, role, profiles!memberships_user_id_fkey(full_name, phone)').eq('society_id', m.societyId).eq('status', 'active').in('role', ['admin', 'super_admin']),
      ),
  });

  const catName = useMemo(() => Object.fromEntries((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data]);
  const pinnedIds = new Set((cats.data ?? []).filter((c) => c.is_pinned).map((c) => c.id));

  const filtered = (contacts.data ?? []).filter(
    (c) =>
      c.status === 'active' &&
      (!category || c.category_id === category) &&
      (!search || `${c.name} ${c.phone} ${c.notes ?? ''} ${catName[c.category_id] ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  );
  const suggestions = (contacts.data ?? []).filter((c) => c.status === 'suggested' && (canManage || c.added_by === m.userId));
  const groups = (cats.data ?? [])
    .map((cat) => ({ cat, list: filtered.filter((c) => c.category_id === cat.id) }))
    .filter((g) => g.list.length)
    .sort((a, b) => Number(pinnedIds.has(b.cat.id)) - Number(pinnedIds.has(a.cat.id)) || a.cat.sort_order - b.cat.sort_order);

  const save = async () => {
    const phone = normalizeMobile(form.phone ?? '');
    const alt = form.alt_phone ? normalizeMobile(form.alt_phone) : '';
    if (!form.category_id) return toast.error(t('Choose a category'));
    if ((form.name ?? '').trim().length < 2) return toast.error(t('Name must be 2–60 characters.'));
    if (!MOBILE_RE.test(phone)) return toast.error(t('Enter a valid 10-digit Indian mobile number'));
    if (alt && !MOBILE_RE.test(alt)) return toast.error(t('Alternate number is not valid'));
    setBusy(true);
    try {
      if (form.mode === 'suggest') {
        await rpc('suggest_contact', { p_society: m.societyId, p_category_id: form.category_id, p_name: form.name, p_phone: phone, p_notes: form.notes ?? null });
        toast.success(t('Thanks! The admin will review your suggestion.'));
      } else {
        await rpc('upsert_contact', {
          p_society: m.societyId,
          p_id: form.mode === 'edit' ? form.id : null,
          p_category_id: form.category_id,
          p_name: form.name,
          p_phone: phone,
          p_alt_phone: alt || null,
          p_whatsapp: form.whatsapp ?? true,
          p_notes: form.notes ?? null,
          p_timings: form.timings ?? null,
          p_typical_rate: form.typical_rate ?? null,
        });
        toast.success(t('Contact saved'));
      }
      setForm({ open: false, mode: 'add' });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
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
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addCategory = async () => {
    try {
      await rpc('upsert_contact_category', { p_society: m.societyId, p_id: null, p_name: catForm.name, p_sort_order: 50, p_is_pinned: false });
      void qc.invalidateQueries({ queryKey: ['contactCategories'] });
      setCatForm({ open: false, name: '' });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Contacts')}
        subtitle={t('Trusted help for the society')}
        back="/more"
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setForm({ open: true, mode: 'add', whatsapp: true, category_id: category || undefined })}>
              <Plus /> {t('Add')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setForm({ open: true, mode: 'suggest', category_id: category || undefined })}>
              <UserPlus /> {t('Suggest')}
            </Button>
          )
        }
      />
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search name or service')} className="pl-10" aria-label={t('Search')} />
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-40" aria-label={t('Category')}>
          <option value="">{t('All')}</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {t(c.name)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {!category && !search && (committee.data ?? []).length > 0 && (
        <>
          <SectionTitle>{t('Admins / committee')}</SectionTitle>
          <div className="space-y-2">
            {committee.data!.map((a) => (
              <ContactCard
                key={a.user_id}
                name={a.profiles?.full_name ?? ''}
                phone={a.profiles?.phone ?? null}
                whatsapp
                sub={a.role === 'super_admin' ? t('Super admin') : t('Admin')}
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
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="tabular text-[12.5px] text-muted-foreground">
                      {t(catName[c.category_id] ?? '')} · {c.phone}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1.5">
                      <Button size="icon-sm" onClick={() => act('review_contact', { p_contact_id: c.id, p_approve: true }, t('Contact approved'))} aria-label={t('Approve')}>
                        <Check />
                      </Button>
                      <Button size="icon-sm" variant="outline" onClick={() => act('review_contact', { p_contact_id: c.id, p_approve: false }, t('Suggestion rejected'))} aria-label={t('Reject')}>
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

      <QueryState query={contacts} empty={() => (groups.length ? null : <EmptyState icon={<Phone className="size-7" />} title={t('No contacts yet')} hint={canManage ? t('Add the plumber, electrician, tank cleaner…') : t('Suggest a good plumber or electrician you know.')} />)}>
        {() =>
          groups.map(({ cat, list }) => (
            <section key={cat.id}>
              <SectionTitle>{t(cat.name)}</SectionTitle>
              <div className="space-y-2">
                {list.map((c) => (
                  <ContactCard
                    key={c.id}
                    name={c.name}
                    phone={c.phone}
                    alt={c.alt_phone}
                    whatsapp={c.whatsapp}
                    sub={[c.timings, c.typical_rate, c.notes].filter(Boolean).join(' · ')}
                    actions={
                      canManage && (
                        <>
                          <Button size="icon-sm" variant="ghost" onClick={() => setForm({ ...c, open: true, mode: 'edit' })} aria-label={t('Edit')}>
                            <Pencil />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => act('archive_contact', { p_contact_id: c.id }, t('Contact removed'))} aria-label={t('Remove')}>
                            <Archive />
                          </Button>
                        </>
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))
        }
      </QueryState>

      <Dialog open={form.open} onOpenChange={(o) => !o && setForm({ open: false, mode: 'add' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.mode === 'edit' ? t('Edit contact') : form.mode === 'suggest' ? t('Suggest a contact') : t('Add contact')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('Category')}>
              <div className="flex gap-2">
                <div className="flex-1">
                  <NativeSelect value={form.category_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">{t('Choose…')}</option>
                    {cats.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t(c.name)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {canManage && (
                  <Button variant="outline" size="icon" onClick={() => setCatForm({ open: true, name: '' })} aria-label={t('Add category')}>
                    <Plus />
                  </Button>
                )}
              </div>
            </Field>
            <Field label={t('Name')}>
              <Input value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={60} />
            </Field>
            <Field label={t('Phone')}>
              <Input type="tel" inputMode="numeric" value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            {form.mode !== 'suggest' && (
              <>
                <Field label={t('Alternate phone')} optional>
                  <Input type="tel" inputMode="numeric" value={form.alt_phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, alt_phone: e.target.value }))} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('Timings')} optional>
                    <Input value={form.timings ?? ''} onChange={(e) => setForm((f) => ({ ...f, timings: e.target.value }))} maxLength={80} placeholder="9am–7pm" />
                  </Field>
                  <Field label={t('Typical rate')} optional>
                    <Input value={form.typical_rate ?? ''} onChange={(e) => setForm((f) => ({ ...f, typical_rate: e.target.value }))} maxLength={80} placeholder="₹300/visit" />
                  </Field>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center justify-between">
                  <span className="text-sm font-semibold">{t('On WhatsApp')}</span>
                  <Switch checked={form.whatsapp ?? true} onCheckedChange={(v) => setForm((f) => ({ ...f, whatsapp: v }))} />
                </label>
              </>
            )}
            <Field label={t('Area / notes')} optional>
              <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} maxLength={300} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm({ open: false, mode: 'add' })}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={busy}>
              {form.mode === 'suggest' ? t('Send suggestion') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catForm.open} onOpenChange={(o) => setCatForm((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('New category')}</DialogTitle>
          </DialogHeader>
          <Field label={t('Name')}>
            <Input value={catForm.name} onChange={(e) => setCatForm((s) => ({ ...s, name: e.target.value }))} maxLength={40} />
          </Field>
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
    </div>
  );
}

function ContactCard({
  name,
  phone,
  alt,
  whatsapp,
  sub,
  icon,
  actions,
}: {
  name: string;
  phone: string | null;
  alt?: string | null;
  whatsapp?: boolean;
  sub?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{icon ?? <Phone className="size-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="tabular truncate text-[12.5px] text-muted-foreground">
          {phone ?? t('No phone added')}
          {alt ? ` · ${alt}` : ''}
        </p>
        {sub && <p className="truncate text-[12px] text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {phone && (
          <>
            {whatsapp && (
              <Button asChild size="icon-sm" variant="outline" aria-label={t('WhatsApp {{n}}', { n: name })}>
                <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                </a>
              </Button>
            )}
            <Button asChild size="icon-sm" aria-label={t('Call {{n}}', { n: name })}>
              <a href={`tel:+91${phone}`}>
                <Phone />
              </a>
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
