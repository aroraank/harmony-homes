-- 2026-11-26: security guard SALARY (the society-pays-the-guard expense, not the per-flat collection,
-- which already moved to Rs.1,000/flat for December per 20261118000001) rises from Rs.15,000 to
-- Rs.15,600/month per the guard's new quotation. This is the amount admins mark as paid on
-- "Pay guard salary" each month. The current (November 2026, paid in arrears) payment must stay
-- Rs.15,000 -- if its draft row hasn't been generated yet, this locks it in at the old amount first;
-- then the template amount is bumped so every month's draft generated from here on (starting December)
-- comes out at Rs.15,600.
-- Safe to run more than once.

insert into public.expense_drafts (society_id, template_id, period, amount_paise)
select t.society_id, t.id, public.period_of(public.ist_today()), t.amount_paise
  from public.expense_templates t
 where t.title ilike 'security guard salary%'
on conflict (template_id, period) do nothing;

update public.expense_templates
   set amount_paise = 1560000
 where title ilike 'security guard salary%';
