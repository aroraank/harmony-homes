import { AuthLayout } from './AuthLayout';

export default function SetupNeededPage() {
  return (
    <AuthLayout title="Almost there" subtitle="Connect the app to your Supabase project.">
      <div className="space-y-3 text-sm">
        <p>
          Set <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> and <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code>{' '}
          in <code className="rounded bg-muted px-1">apps/web/.env.local</code> (local) or in Netlify → Site settings → Environment variables, then rebuild.
        </p>
        <p className="text-muted-foreground">See README.md → “Setup” for the full checklist.</p>
      </div>
    </AuthLayout>
  );
}
