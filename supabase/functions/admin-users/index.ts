// admin-users: super admin / user-manager actions that need the Supabase Auth admin API.
//   bulk_create_logins   { society_id, unit_ids? }        -> one-time credential slips
//   reset_password       { membership_id }                -> new one-time temporary password, devices signed out
//   create_staff         { society_id, username, full_name, phone?, role }
//   approve_registration { membership_id, replace? }
import {
  generateTempPassword,
  handle,
  HttpError,
  json,
  readJson,
  requireUser,
  rpcError,
  serviceClient,
  usernameToEmail,
} from '../_shared/http.ts';

type Body = {
  action?: string;
  society_id?: string;
  unit_ids?: string[];
  membership_id?: string;
  username?: string;
  full_name?: string;
  phone?: string;
  role?: string;
  replace?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handle(async (req) => {
    const svc = serviceClient();
    const actor = await requireUser(req, svc);
    const body = await readJson<Body>(req);

    const requirePerm = async (societyId: string | undefined, perm: string) => {
      if (!societyId || !UUID_RE.test(societyId)) throw new HttpError(400, 'Missing society.');
      const { data, error } = await svc.rpc('user_has_perm', { p_user: actor.id, p_society: societyId, p_perm: perm });
      if (error) rpcError(error);
      if (data !== true) throw new HttpError(403, 'You do not have permission to do this.');
      const { data: soc, error: e2 } = await svc.from('societies').select('slug').eq('id', societyId).single();
      if (e2 || !soc) throw new HttpError(404, 'Society not found.');
      return soc.slug as string;
    };

    switch (body.action) {
      case 'bulk_create_logins': {
        const slug = await requirePerm(body.society_id, 'manage_users');
        const unitIds = Array.isArray(body.unit_ids) && body.unit_ids.length ? body.unit_ids.filter((u) => UUID_RE.test(u)) : null;
        const { data: units, error } = await svc.rpc('_units_needing_login', { p_society: body.society_id, p_unit_ids: unitIds });
        if (error) rpcError(error);
        const list = (units ?? []) as { id: string; code: string; display_name: string }[];
        if (list.length > 300) throw new HttpError(400, 'Create at most 300 logins at a time.');
        const slips: { unit_code: string; display_name: string; username: string; password: string }[] = [];
        const errors: { unit_code: string; error: string }[] = [];
        for (const u of list) {
          const password = generateTempPassword(12);
          const { data: created, error: ce } = await svc.auth.admin.createUser({
            email: usernameToEmail(u.code, slug),
            password,
            email_confirm: true,
            user_metadata: { unit_code: u.code, society: slug },
          });
          if (ce || !created.user) {
            errors.push({ unit_code: u.code, error: ce?.message ?? 'Could not create login' });
            continue;
          }
          const { error: me } = await svc.rpc('_create_unit_member', {
            p_actor: actor.id,
            p_user: created.user.id,
            p_society: body.society_id,
            p_unit: u.id,
          });
          if (me) {
            await svc.auth.admin.deleteUser(created.user.id);
            errors.push({ unit_code: u.code, error: me.message });
            continue;
          }
          slips.push({ unit_code: u.code, display_name: u.display_name, username: u.code, password });
        }
        await svc.rpc('_log_admin_action', {
          p_actor: actor.id,
          p_society: body.society_id,
          p_action: 'bulk_create_logins',
          p_details: { count: slips.length, units: slips.map((s) => s.unit_code), errors },
        });
        return json(req, { slips, errors });
      }

      case 'reset_password': {
        if (!body.membership_id || !UUID_RE.test(body.membership_id)) throw new HttpError(400, 'Missing member.');
        const { data: ctx, error } = await svc.rpc('_member_for_admin_action', {
          p_actor: actor.id,
          p_membership_id: body.membership_id,
          p_perm: 'manage_users',
        });
        if (error) rpcError(error);
        const { data: target } = await svc.auth.admin.getUserById(ctx.user_id);
        const username = (target.user?.email ?? '').split('@')[0]?.toUpperCase() ?? ctx.unit_code;
        const password = generateTempPassword(12);
        const { error: ue } = await svc.auth.admin.updateUserById(ctx.user_id, { password });
        if (ue) throw new HttpError(400, ue.message);
        const { error: pe } = await svc.rpc('_after_password_reset', { p_actor: actor.id, p_user: ctx.user_id });
        if (pe) rpcError(pe);
        await svc.rpc('_log_admin_action', {
          p_actor: actor.id,
          p_society: ctx.society_id,
          p_action: 'reset_password',
          p_details: { user_id: ctx.user_id, username },
        });
        return json(req, { username, password, unit_code: ctx.unit_code });
      }

      case 'create_staff': {
        const slug = await requirePerm(body.society_id, 'manage_users');
        const username = (body.username ?? '').trim();
        if (!/^[a-zA-Z][a-zA-Z0-9-]{1,39}$/.test(username)) {
          throw new HttpError(400, 'Username must start with a letter and use letters, digits or dashes.');
        }
        const role = body.role === 'super_admin' ? 'super_admin' : 'admin';
        const password = generateTempPassword(12);
        const { data: created, error: ce } = await svc.auth.admin.createUser({
          email: usernameToEmail(username, slug),
          password,
          email_confirm: true,
          user_metadata: { society: slug, staff: true },
        });
        if (ce || !created.user) {
          const taken = /already|exists|registered/i.test(ce?.message ?? '');
          throw new HttpError(taken ? 409 : 400, taken ? 'That username is taken.' : ce?.message ?? 'Could not create login.');
        }
        const { error: me } = await svc.rpc('_create_staff_member', {
          p_actor: actor.id,
          p_user: created.user.id,
          p_society: body.society_id,
          p_name: body.full_name ?? '',
          p_phone: body.phone ?? null,
          p_role: role,
        });
        if (me) {
          await svc.auth.admin.deleteUser(created.user.id);
          rpcError(me);
        }
        return json(req, { username: username.toUpperCase(), password });
      }

      case 'approve_registration': {
        if (!body.membership_id || !UUID_RE.test(body.membership_id)) throw new HttpError(400, 'Missing registration.');
        const args = { p_membership_id: body.membership_id, p_approver: actor.id, p_replace: !!body.replace };
        const { data: plan, error } = await svc.rpc('_approve_registration', { ...args, p_dry_run: true });
        if (error) rpcError(error);
        const unitEmail = usernameToEmail(plan.unit_code, plan.slug);
        const { data: newUser } = await svc.auth.admin.getUserById(plan.user_id);
        const pendingEmail = newUser.user?.email ?? '';
        let oldEmail: string | null = null;

        // 1) move the old account's login out of the way, 2) give the new account the flat's username
        if (plan.old_user_id) {
          const { data: oldUser } = await svc.auth.admin.getUserById(plan.old_user_id);
          oldEmail = oldUser.user?.email ?? null;
          const { error: oe } = await svc.auth.admin.updateUserById(plan.old_user_id, {
            email: `${plan.unit_code.toLowerCase()}.old-${Date.now()}@${plan.slug}.local`,
            email_confirm: true,
          });
          if (oe) throw new HttpError(400, oe.message);
        }
        const { error: ne } = await svc.auth.admin.updateUserById(plan.user_id, { email: unitEmail, email_confirm: true });
        if (ne) {
          if (plan.old_user_id && oldEmail) await svc.auth.admin.updateUserById(plan.old_user_id, { email: oldEmail, email_confirm: true });
          throw new HttpError(400, ne.message);
        }
        const { error: ae } = await svc.rpc('_approve_registration', { ...args, p_dry_run: false });
        if (ae) {
          await svc.auth.admin.updateUserById(plan.user_id, { email: pendingEmail, email_confirm: true });
          if (plan.old_user_id && oldEmail) await svc.auth.admin.updateUserById(plan.old_user_id, { email: oldEmail, email_confirm: true });
          rpcError(ae);
        }
        return json(req, { ok: true, username: plan.unit_code });
      }

      default:
        throw new HttpError(400, 'Unknown action.');
    }
  }),
);
