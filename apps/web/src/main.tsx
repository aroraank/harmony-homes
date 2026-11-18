import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Toaster } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './lib/i18n';
import { persister, queryClient, shouldPersist } from './lib/queryClient';
import { AuthProvider } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { captureInstallPrompt } from './lib/install';
import App from './App';

captureInstallPrompt();

declare const __BUILD_ID__: string;

/** Reload once per new version; the guard stops a reload loop if something goes wrong. */
function reloadForUpdate() {
  try {
    const last = Number(sessionStorage.getItem('hh-upd-reload') ?? 0);
    if (Date.now() - last < 15_000) return;
    sessionStorage.setItem('hh-upd-reload', String(Date.now()));
  } catch {
    /* storage blocked: still reload */
  }
  window.location.reload();
}

/** Last resort: drop the service worker and caches so the next load fetches everything fresh. */
async function hardRefresh() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
  reloadForUpdate();
}

async function checkVersion(registration?: ServiceWorkerRegistration) {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (!build || build === __BUILD_ID__) return;
    await registration?.update();
    // Give the new service worker a moment to take over (it triggers a reload itself); otherwise force it.
    setTimeout(() => void hardRefresh(), 6000);
  } catch {
    /* offline: try again next time */
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // A new service worker now activates by itself; reload so the page runs the new code.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadForUpdate();
  });
  const updateSW = registerSW({
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        void registration.update();
        void checkVersion(registration);
      };
      setInterval(check, 10 * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      check();
    },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 1000 * 60 * 60 * 24 * 7,
          buster: 'v1',
          dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' && shouldPersist(q.queryKey) },
        }}
      >
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'rounded-2xl' }} />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
