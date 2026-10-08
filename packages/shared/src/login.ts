/** Username (unit code or staff handle) -> synthetic Supabase Auth email */
export function usernameToEmail(username: string, societySlug: string): string {
  const u = username.trim();
  if (u.includes('@')) return u.toLowerCase();
  return `${u.toLowerCase()}@${societySlug.toLowerCase()}.local`;
}

export function emailToUsername(email: string): string {
  return (email.split('@')[0] ?? '').toUpperCase();
}
