import type { ReactNode } from 'react';
import { brand } from '@/brand';

/** Shared look for sign-in, registration and password screens */
export function AuthLayout({ title, subtitle, children, society }: { title: string; subtitle?: string; children: ReactNode; society?: string | null }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="hero-gradient safe-top relative overflow-hidden px-6 pb-20 pt-10 text-white">
        <div aria-hidden className="absolute -right-10 -top-10 size-48 rounded-full bg-lime-300/20 blur-2xl" />
        <div className="relative mx-auto max-w-md">
          <div className="flex items-center gap-3">
            <img src={brand.logo} alt="" width={48} height={48} className="size-12 rounded-2xl ring-1 ring-white/30" />
            <div>
              <p className="text-xl font-extrabold tracking-tight">{brand.name}</p>
              {society ? <p className="text-sm text-white/85">{society}</p> : <p className="text-sm text-white/80">{brand.tagline}</p>}
            </div>
          </div>
          <h1 className="mt-8 text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-white/85">{subtitle}</p>}
        </div>
      </div>
      <div className="relative mx-auto -mt-12 max-w-md px-4 pb-10">
        <div className="rounded-3xl border bg-card p-5 shadow-xl animate-fade-up">{children}</div>
      </div>
    </div>
  );
}
