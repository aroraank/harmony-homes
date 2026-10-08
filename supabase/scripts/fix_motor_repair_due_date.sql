-- Sets the due date of "Motor repair — 3BHK" to 11 Oct 2026 (event and any dues already created).
do $$
declare v_ev uuid; v_n int;
begin
  select id into v_ev from events where title = 'Motor repair — 3BHK' order by created_at desc limit 1;
  if v_ev is null then raise exception 'Event "Motor repair — 3BHK" not found.'; end if;
  update events set due_date = date '2026-10-11' where id = v_ev;
  update dues set due_date = date '2026-10-11' where event_id = v_ev;
  get diagnostics v_n = row_count;
  raise notice 'Updated event % and % dues to 11 Oct 2026', v_ev, v_n;
end $$;
