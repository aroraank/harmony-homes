-- Never surface the super admin's name as the meeting caller: "Called by" should
-- only show a regular admin's name, never the super admin's.
create or replace view public.v_meetings with (security_invoker = true) as
select
  mt.id, mt.society_id, mt.title, mt.description, mt.status, mt.scope_type,
  mt.scope_unit_type_ids, mt.scope_unit_ids, mt.meeting_date, mt.start_time, mt.location,
  mt.created_by, mt.published_at, mt.created_at, mt.updated_at,
  public._meeting_audience_label(mt.id) as audience_label,
  coalesce((select jsonb_agg(jsonb_build_object(
                'id', ai.id, 'text', ai.text, 'status', ai.status,
                'by', case when ai.suggested_by is not null then public._person_label(ai.suggested_by, mt.society_id) end,
                'mine', ai.suggested_by is not null and ai.suggested_by = auth.uid())
              order by (ai.status = 'suggested'), ai.position, ai.created_at)
              from meeting_agenda_items ai where ai.meeting_id = mt.id and ai.status <> 'rejected'), '[]'::jsonb) as agenda,
  case
    when cm.role = 'super_admin' then null
    else p.full_name
  end as created_by_name
from meetings mt
left join profiles p on p.id = mt.created_by
left join memberships cm on cm.user_id = mt.created_by and cm.society_id = mt.society_id and cm.status = 'active';
revoke all on public.v_meetings from anon, authenticated;
grant select on public.v_meetings to authenticated;
