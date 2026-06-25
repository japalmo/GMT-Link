import { useState, type ReactNode } from 'react';
import { FinanzasTabs, type FinanzasTab } from './finanzas-tabs';
import { ReembolsosTab } from './reembolsos';
import { HorasExtraTab } from './horas-extra';
import { LiquidacionesTab } from './liquidaciones';

/**
 * Página Finanzas (§6-3.1 Reembolsos / §6-3.3 Horas extra / §6-3.4 Liquidaciones).
 *
 * Cáscara del módulo: header + toggle de pestañas. El contenido de cada pestaña
 * (lista propia, formulario de solicitud y, para gestores, la lista global con
 * acciones) vive en su respectivo componente Tab. El gating de gestión es
 * un probe silencioso dentro de los hooks, no se decide por rol aquí.
 */
export default function FinanzasPage(): ReactNode {
  const [tab, setTab] = useState<FinanzasTab>('reembolsos');

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finanzas</h1>
          <p className="text-sm text-muted-foreground">
            Reembolsos, horas extra y liquidaciones de sueldo.
          </p>
        </div>
        <FinanzasTabs active={tab} onChange={setTab} />
      </header>

      {tab === 'reembolsos' && <ReembolsosTab />}
      {tab === 'horas' && <HorasExtraTab />}
      {tab === 'liquidaciones' && <LiquidacionesTab />}
    </div>
  );
}

