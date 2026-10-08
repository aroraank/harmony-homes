import { AppError, invokeFn, supabase } from './supabase';
import { queryClient } from './queryClient';
import { setLocal } from './storage';
import { getViewAs, setViewAs } from './viewAsState';

function clearCaches() {
  queryClient.clear();
  setLocal('hh-cache', null); // persisted offline cache must not mix two people's data
}

/** Super admin only: open the app as another member, read-only. */
export async function startViewAs(societyId: string, membershipId: string, viewerName: string) {
  const { data } = await supabase.auth.getSession();
  const own = data.session;
  if (!own) throw new AppError('Please sign in again.');
  const res = await invokeFn<{ token_hash: string; label: string; role: string }>('admin-users', {
    action: 'view_as',
    society_id: societyId,
    membership_id: membershipId,
  });
  setViewAs({
    access_token: own.access_token,
    refresh_token: own.refresh_token,
    viewer_name: viewerName,
    label: res.label,
    role: res.role,
    started_at: new Date().toISOString(),
  });
  const { error } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: 'magiclink' });
  if (error) {
    setViewAs(null);
    await supabase.auth.setSession({ access_token: own.access_token, refresh_token: own.refresh_token }).catch(() => undefined);
    throw new AppError('Could not open the member view. Please try again.');
  }
  clearCaches();
  window.location.assign('/');
}

/** Leave the member view and return to the super admin's own account. */
export async function stopViewAs() {
  const v = getViewAs();
  setViewAs(null);
  clearCaches();
  // end the borrowed session on the server, then restore the parked one
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (v) {
    const { error } = await supabase.auth.setSession({ access_token: v.access_token, refresh_token: v.refresh_token });
    if (error) {
      window.location.assign('/login');
      return;
    }
  }
  window.location.assign('/admin/members');
}
