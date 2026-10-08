import { brand } from '@/brand';

export function Splash() {
  return (
    <div className="hero-gradient grid min-h-dvh place-items-center text-white" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-3">
        <img src={brand.logo} alt="" className="size-16 animate-pulse rounded-2xl ring-1 ring-white/30" width={64} height={64} />
        <p className="text-lg font-extrabold tracking-tight">{brand.name}</p>
      </div>
    </div>
  );
}
