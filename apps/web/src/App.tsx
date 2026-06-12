import { useEffect, useState } from 'react';
import type { HealthResponse } from '@gtm-link/shared-types';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

type ApiStatus = 'loading' | 'ok' | 'down';

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading');

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
    let cancelled = false;

    async function checkHealth(): Promise<void> {
      try {
        const res = await fetch(`${apiUrl}/health`);
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setApiStatus(data.status === 'ok' ? 'ok' : 'down');
      } catch {
        if (!cancelled) setApiStatus('down');
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold tracking-tight">GTM Link</h1>
      <p className="text-muted max-w-sm text-center text-sm">
        Plataforma interna de operaciones de GMT. Monorepo inicializado — Etapa 0.1.
      </p>
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
          apiStatus === 'ok' && 'bg-green-100 text-green-800',
          apiStatus === 'down' && 'bg-red-100 text-red-800',
          apiStatus === 'loading' && 'bg-gray-100 text-gray-600',
        )}
      >
        <Activity className="size-3.5" aria-hidden />
        {apiStatus === 'loading' && 'Verificando API…'}
        {apiStatus === 'ok' && 'API conectada'}
        {apiStatus === 'down' && 'API no disponible'}
      </span>
    </main>
  );
}
