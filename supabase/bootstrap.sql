-- Harmony Homes — make yourself the super admin (run once in the SQL editor).
-- 1) Authentication → Users → "Add user" → email: admin@plot-colony.local, a strong password, tick "Auto Confirm User".
-- 2) Run:
select public.bootstrap_super_admin('superadmin@plot-colony.local', 'plot-colony', 'Ankit Arora');
-- 3) Sign in to the app with society code "plot-colony", username "admin" and that password.
