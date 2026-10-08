// account: actions a member performs on their own account.
//   register        (public)  { society_slug, unit_id, full_name, mobile, password } -> pending registration
//   change_password (signed in) { current_password, new_password }                  -> clears the first-login flag
import {
  anonClient,
  handle,
  HttpError,
  json,
  passwordProblems,
  readJson,
  requireUser,
  rpcError,
  serviceClient,
} from '../_shared/http.ts';

type Body = {
  action?: string;
  society_slug?: string;
  unit_id?: string;
  full_name?: string;
  mobile?: string;
  password?: string;
  current_password?: string;
  new_password?: string;
};

Deno.serve(
  handle(async (req) => {
    const svc = serviceClient();
    const body = await readJson<Body>(req);

    switch (body.action) {
      case 'register': {
        const slug = (body.society_slug ?? '').toLowerCase().trim();
        if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new HttpError(400, 'Society not found.');
        if (!body.unit_id) throw new HttpError(400, 'Choose your flat.');
        const { data: check, error } = await svc.rpc('_registration_check', {
          p_slug: slug,
          p_unit_id: body.unit_id,
          p_name: body.full_name ?? '',
          p_phone: body.mobile ?? '',
        });
        if (error) rpcError(error);
        if (!check.ok) throw new HttpError(409, check.message, check.code);
        const problems = passwordProblems(body.password ?? '', check.unit_code);
        if (problems.length) throw new HttpError(400, `PIN must be ${problems.join(', ')}.`);

        const { data: created, error: ce } = await svc.auth.admin.createUser({
          email: `pending-${crypto.randomUUID()}@${slug}.local`,
          password: body.password,
          email_confirm: true,
          user_metadata: { society: slug, pending_unit: check.unit_code },
        });
        if (ce || !created.user) throw new HttpError(400, ce?.message ?? 'Could not register.');
        const { error: re } = await svc.rpc('_registration_create', {
          p_user: created.user.id,
          p_society: check.society_id,
          p_unit: body.unit_id,
          p_name: check.name,
          p_phone: check.phone,
        });
        if (re) {
          await svc.auth.admin.deleteUser(created.user.id);
          rpcError(re);
        }
        return json(req, { ok: true, username: check.unit_code });
      }

      case 'change_password': {
        const user = await requireUser(req, svc);
        const email = user.email ?? '';
        const username = email.split('@')[0] ?? '';
        const current = body.current_password ?? '';
        const next = body.new_password ?? '';
        const problems = passwordProblems(next, username, current);
        if (problems.length) throw new HttpError(400, `New PIN must be ${problems.join(', ')}.`);

        // Verify the current password, then immediately revoke the throwaway session it created.
        const anon = anonClient();
        const { error: se } = await anon.auth.signInWithPassword({ email, password: current });
        if (se) throw new HttpError(400, 'Current PIN is incorrect.', 'bad_password');
        await anon.auth.signOut({ scope: 'local' });

        const { error: ue } = await svc.auth.admin.updateUserById(user.id, { password: next });
        if (ue) throw new HttpError(400, ue.message);
        const { error: ce } = await svc.rpc('_clear_must_change', { p_user: user.id });
        if (ce) rpcError(ce);
        return json(req, { ok: true });
      }

      default:
        throw new HttpError(400, 'Unknown action.');
    }
  }),
);
