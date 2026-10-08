-- Creates 4 admin logins (admin1 … admin4) with random 6-digit PINs. Run in the Supabase SQL editor.
-- Result grid at the bottom: username + PIN to share. PINs are shown ONLY here — copy them now.
-- Each admin must set a new 6-digit PIN on first sign-in. Re-running skips usernames that already exist.
-- Change v_slug / the names below if needed.
create temp table if not exists _new_admins (username text, pin text, status text);
truncate _new_admins;
do $$
declare
  v_slug constant text := 'plot-colony';
  v_society uuid;
  v_user uuid;
  v_pin text;
  v_email text;
  i int;
begin
  select id into v_society from public.societies where slug = v_slug;
  if v_society is null then raise exception 'Society % not found', v_slug; end if;
  for i in 1..4 loop
    v_email := 'admin' || i || '@' || v_slug || '.local';
    if exists (select 1 from auth.users where email = v_email) then
      insert into _new_admins values ('admin' || i, null, 'already exists – skipped');
      continue;
    end if;
    v_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_pin, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('society', v_slug, 'staff', true), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, v_user::text, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
    insert into public.profiles (id, full_name, must_change_password) values (v_user, 'Admin ' || i, true);
    insert into public.memberships (user_id, society_id, unit_id, role, status, approved_at)
    values (v_user, v_society, null, 'admin', 'active', now());
    insert into _new_admins values ('admin' || i, v_pin, 'created');
  end loop;
end $$;
select username as "Username", pin as "PIN", status as "Status" from _new_admins order by username;
