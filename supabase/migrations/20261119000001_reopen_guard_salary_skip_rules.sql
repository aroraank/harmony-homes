-- 2026-11-19: fixed monthly expenses (e.g. the security guard's salary) can no longer be skipped by accident.
--  1) Re-open November 2026's guard salary, which an admin skipped with a single tap on 1 Nov (21:37 IST).
--  2) skip_expense_draft now needs a written reason, works only for the current month and only up to the
--     15th, and tells every member (so a skipped salary can never go unnoticed).
--  3) reopen_expense_draft lets an admin undo a skip.
-- Safe to run more than once.

-- 1) Re-open this month's skipped guard-salary entry (only if it is still skipped) and tell the admins
do $$
declare r record; v_n int := 0;
begin
  for r in
    select d.id, d.society_id, d.period, t.title
      from public.expense_drafts d
      join public.expense_templates t on t.id = d.template_id
     where d.status = 'skipped' and d.period = '2026-11' and t.title ilike 'security guard salary%'
  loop
    update public.expense_drafts
       set status = 'pending', ledger_entry_id = null, resolved_by = null, resolved_at = null
     where id = r.id;
    perform public._notify(r.society_id, public._perm_user_ids(r.society_id, 'record_expense'), 'expense_drafts', null,
      format('%s for %s is waiting to be marked as paid', r.title, to_char(to_date(r.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY')),
      'It was skipped by mistake and has been re-opened. Tap to mark it as paid.', '/admin/expenses');
    perform public.audit_append(r.society_id, 'expense_draft_reopened', 'expense_drafts', r.id::text, null,
      jsonb_build_object('title', r.title, 'period', r.period, 'reason', 'skipped by mistake'));
    v_n := v_n + 1;
  end loop;
  raise notice 're-opened % draft(s)', v_n;
end $$;

-- 2) Skip needs a reason, current month only, up to the 15th, and everyone is told
drop function if exists public.skip_expense_draft(uuid);
create or replace function public.skip_expense_draft(p_draft_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d record; v_title text; v_reason text := public.clean_text(p_reason); v_label text;
begin
  select * into d from expense_drafts where id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'Already handled.'; end if;
  if d.period <> public.period_of(public.ist_today()) then
    raise exception using errcode = 'P0001', message = 'Only this month''s payment can be skipped. Please mark the older one as paid.';
  end if;
  if extract(day from public.ist_today())::int > 15 then
    raise exception using errcode = 'P0001', message = 'This payment can only be skipped up to the 15th of the month. Please mark it as paid.';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Please give a reason (at least 5 characters). Everyone in the society will see it.';
  end if;
  select title into v_title from expense_templates where id = d.template_id;
  v_label := to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  update expense_drafts set status = 'skipped', resolved_by = auth.uid(), resolved_at = now() where id = d.id;
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'expense_skipped', null,
    format('%s for %s not paid yet', v_title, v_label), left(v_reason, 300), '/events/recurring');
  perform public.audit_append(d.society_id, 'expense_draft_skipped', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', v_title, 'period', d.period, 'reason', v_reason));
end $$;

-- 3) Undo a skip
create or replace function public.reopen_expense_draft(p_draft_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d record; v_title text;
begin
  select * into d from expense_drafts where id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'skipped' then raise exception using errcode = 'P0001', message = 'Only a skipped payment can be re-opened.'; end if;
  select title into v_title from expense_templates where id = d.template_id;
  update expense_drafts set status = 'pending', ledger_entry_id = null, resolved_by = null, resolved_at = null where id = d.id;
  perform public.audit_append(d.society_id, 'expense_draft_reopened', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', v_title, 'period', d.period));
end $$;

revoke execute on function public.skip_expense_draft(uuid, text) from public, anon;
revoke execute on function public.reopen_expense_draft(uuid) from public, anon;
grant execute on function public.skip_expense_draft(uuid, text) to authenticated;
grant execute on function public.reopen_expense_draft(uuid) to authenticated;
