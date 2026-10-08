import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Toaster, toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import './lib/i18n';
import i18n from './lib/i18n';
import { persister, queryClient, shouldPersist } from './lib/queryClient';
import { AuthProvider } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { captureInstallPrompt } from './lib/install';
import App from './App';

captureInstallPrompt();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast(i18n.t('A new version of Harmony Homes is available.'), {
        duration: Infinity,
        action: { label: i18n.t('Update'), onClick: () => void updateSW(true) },
      });
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
