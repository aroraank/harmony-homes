-- The "add your vehicle" announcement popup is meant for flat owners only, not for the
-- admins/super admins who also happen to hold a resident membership, and guards never reach
-- this RPC at all (they log in through the separate guards table, not memberships). Restrict
-- my_vehicle_prompt() to role = 'resident' so admins and super admins never see it.

create or replace function public.my_vehicle_prompt(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit uuid; v_show boolean;
begin
  if public.my_role(p_society) is null then return jsonb_build_object('show', false); end if;
  select unit_id into v_unit from memberships
   where user_id = auth.uid() and society_id = p_society and status = 'active'
     and role = 'resident' and unit_id is not null limit 1;
  if v_unit is null then return jsonb_build_object('show', false); end if;
  v_show := (select vehicle_prompt_at is null from profiles where id = auth.uid())
            and not exists (select 1 from vehicles where unit_id = v_unit);
  return jsonb_build_object('show', coalesce(v_show, false), 'unit_id', v_unit,
    'unit_code', (select code from units where id = v_unit),
    'unit_name', (select display_name from units where id = v_unit));
end $$;
