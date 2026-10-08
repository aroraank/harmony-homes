-- Harmony Homes — seed for the first society: Plot Colony, Ludhiana
-- 30 units: Plots 1–6 (3BHK) and Plots 9–12 (2BHK), each with Ground / First / Second floor.
-- There are no plots 7–8. Monthly due ₹800 (due on the 7th), guard salary ₹15,000,
-- and an example draft event "Motor repair — 3BHK" for ₹2,40,000.
-- Safe to run once on a fresh database (Supabase SQL editor or `supabase db reset`).

do $$
declare
  v_society uuid;
  v_3bhk uuid;
  v_2bhk uuid;
  v_general uuid;
  v_block uuid;
  v_floor uuid;
  v_plot int;
  v_fl record;
  v_sort int := 0;
  v_event uuid;
  v_scope uuid[];
begin
  if exists (select 1 from public.societies where slug = 'plot-colony') then
    raise notice 'Seed already applied';
    return;
  end if;

  v_society := public.create_society('Plot Colony, Ludhiana', 'plot-colony', to_char(public.ist_today(), 'YYYY-MM'), 80000);
  update public.society_settings set due_day = 7, share_rounding_paise = 1000 where society_id = v_society;

  insert into public.unit_types (society_id, name, sort_order) values (v_society, '3BHK', 1) returning id into v_3bhk;
  insert into public.unit_types (society_id, name, sort_order) values (v_society, '2BHK', 2) returning id into v_2bhk;

  foreach v_plot in array array[1, 2, 3, 4, 5, 6, 9, 10, 11, 12] loop
    insert into public.blocks (society_id, name, sort_order) values (v_society, 'Plot ' || v_plot, v_plot) returning id into v_block;
    for v_fl in select * from (values ('GF', 'Ground Floor', 0), ('FF', 'First Floor', 1), ('SF', 'Second Floor', 2)) as t(code, name, lvl) loop
      insert into public.floors (society_id, block_id, name, level) values (v_society, v_block, v_fl.name, v_fl.lvl) returning id into v_floor;
      v_sort := v_sort + 1;
      insert into public.units (society_id, block_id, floor_id, code, display_name, unit_type_id, sort_order)
      values (v_society, v_block, v_floor, 'P' || v_plot || '-' || v_fl.code, 'Plot ' || v_plot || ', ' || v_fl.name,
              case when v_plot <= 6 then v_3bhk else v_2bhk end, v_sort);
    end loop;
  end loop;

  v_general := public.general_fund_id(v_society);

  insert into public.expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode)
  values (v_society, 'Security guard salary', v_general, 'salary', 'Security guard', 1500000, 1, 'cash');

  -- Example event as a draft so the admin can review expected payers before opening it
  select array_agg(id order by sort_order) into v_scope from public.units where society_id = v_society and unit_type_id = v_3bhk;
  insert into public.events (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, rounding_paise,
                             in_scope_count, expected_count, per_unit_share_paise, due_date, status)
  values (v_society, 'Motor repair — 3BHK', 'Water motor repair shared by the 3BHK plots.', 'unit_types', array[v_3bhk],
          24000000, 1000, array_length(v_scope, 1), array_length(v_scope, 1),
          public.event_share_paise(24000000, array_length(v_scope, 1), 1000), public.ist_today() + 30, 'draft')
  returning id into v_event;
  insert into public.event_units (event_id, unit_id, society_id, expected)
  select v_event, u, v_society, true from unnest(v_scope) u;

  raise notice 'Seeded society % with % units', v_society, (select count(*) from public.units where society_id = v_society);
end $$;
