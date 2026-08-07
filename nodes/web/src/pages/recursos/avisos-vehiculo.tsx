import { type ReactNode, useMemo } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Clock, FileWarning } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AssetDocumentView, ChecklistSubmissionView } from '@/types/assets';

/**
 * Avisos del vehículo, calculados en el cliente a partir de lo que la pantalla
 * ya tiene cargado.
 *
 * Los umbrales de vencimiento son los MISMOS que usa el barrido que manda los
 * correos (`expiry-notices.util.ts`: 30 días, 10 días, y diario los últimos 5).
 * Si se separan, la pantalla y el correo van a decir cosas distintas sobre el
 * mismo documento y nadie va a saber a cuál creerle.
 */
const AVISO_TEMPRANO_DIAS = 30;
const AVISO_MEDIO_DIAS = 10;

/** Días sin checklist a partir de los cuales vale la pena avisar. */
const DIAS_SIN_CHECKLIST = 15;

type Urgencia = 'vencido' | 'critico' | 'proximo' | 'informativo';

interface Aviso {
  id: string;
  urgencia: Urgencia;
  titulo: string;
  detalle: string;
}

const ORDEN: Record<Urgencia, number> = {
  vencido: 0,
  critico: 1,
  proximo: 2,
  informativo: 3,
};

const ESTILO: Record<Urgencia, { caja: string; icono: string }> = {
  vencido: {
    caja: 'border-destructive/40 bg-destructive/5',
    icono: 'text-destructive',
  },
  critico: {
    caja: 'border-amber-500/50 bg-amber-500/5',
    icono: 'text-amber-600 dark:text-amber-500',
  },
  proximo: { caja: 'bg-muted/40', icono: 'text-muted-foreground' },
  informativo: { caja: 'bg-muted/30', icono: 'text-muted-foreground' },
};

/** Días calendario entre hoy y una fecha, ignorando la hora. */
function diasHasta(iso: string): number {
  const hoy = new Date();
  const v = new Date(iso);
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const b = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  return Math.round((b - a) / 86_400_000);
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Cuenta de días en palabras, que se lee mejor que "en -3 días". */
function enPalabras(dias: number): string {
  if (dias < 0) return `Vencido hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`;
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

function avisosDeDocumentos(docs: ReadonlyArray<AssetDocumentView>): Aviso[] {
  const avisos: Aviso[] = [];

  for (const d of docs) {
    if (d.status === 'EN_REVISION' || d.status === 'BORRADOR') {
      avisos.push({
        id: `rev-${d.id}`,
        urgencia: 'informativo',
        titulo: `${d.name} está esperando revisión`,
        detalle: 'Todavía no se aprueba, así que no aparece en la ficha técnica.',
      });
      continue;
    }
    if (d.status === 'RECHAZADO') {
      avisos.push({
        id: `rech-${d.id}`,
        urgencia: 'proximo',
        titulo: `${d.name} fue rechazado`,
        detalle: 'Hay que volver a cargarlo para que quede vigente.',
      });
      continue;
    }
    // Solo los aprobados vencen: un documento sin aprobar no está rigiendo.
    if (d.status !== 'APROBADO' || !d.expirationDate) continue;

    const dias = diasHasta(d.expirationDate);
    if (dias > AVISO_TEMPRANO_DIAS) continue;

    const urgencia: Urgencia =
      dias < 0 ? 'vencido' : dias <= AVISO_MEDIO_DIAS ? 'critico' : 'proximo';
    avisos.push({
      id: `venc-${d.id}`,
      urgencia,
      titulo: `${d.name}: ${enPalabras(dias).toLowerCase()}`,
      detalle: `Fecha de vencimiento ${fecha(d.expirationDate)}.`,
    });
  }

  return avisos;
}

function avisoDeChecklists(submissions: ReadonlyArray<ChecklistSubmissionView>): Aviso | null {
  const ultima = submissions[0]?.createdAt;
  if (!ultima) {
    return {
      id: 'sin-checklist',
      urgencia: 'proximo',
      titulo: 'Sin checklists registrados',
      detalle: 'No hay kilometraje ni revisiones para este vehículo.',
    };
  }
  const dias = -diasHasta(ultima);
  if (dias < DIAS_SIN_CHECKLIST) return null;
  return {
    id: 'checklist-viejo',
    urgencia: 'proximo',
    titulo: `Sin checklist hace ${dias} días`,
    detalle: `El último fue el ${fecha(ultima)}.`,
  };
}

export interface AvisosVehiculoProps {
  docs: ReadonlyArray<AssetDocumentView>;
  submissions: ReadonlyArray<ChecklistSubmissionView>;
}

export function AvisosVehiculo({ docs, submissions }: AvisosVehiculoProps): ReactNode {
  const avisos = useMemo(() => {
    const lista = avisosDeDocumentos(docs);
    const checklist = avisoDeChecklists(submissions);
    if (checklist) lista.push(checklist);
    return lista.sort((a, b) => ORDEN[a.urgencia] - ORDEN[b.urgencia]);
  }, [docs, submissions]);

  const urgentes = avisos.filter((a) => a.urgencia === 'vencido' || a.urgencia === 'critico');
  const resto = avisos.filter((a) => a.urgencia !== 'vencido' && a.urgencia !== 'critico');

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4 text-primary" /> Avisos
          {urgentes.length > 0 ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
              {urgentes.length}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-2">
        {avisos.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <CheckCircle2 className="size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              Sin avisos pendientes para este vehículo.
            </p>
          </div>
        ) : (
          <>
            {/* Lo urgente va suelto arriba, sin scroll: si hay un documento
                vencido nadie debería tener que desplazarse para verlo. */}
            {urgentes.map((a) => (
              <ItemAviso key={a.id} aviso={a} />
            ))}

            {resto.length > 0 ? (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {resto.map((a) => (
                  <ItemAviso key={a.id} aviso={a} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ItemAviso({ aviso }: { aviso: Aviso }): ReactNode {
  const estilo = ESTILO[aviso.urgencia];
  const Icono =
    aviso.urgencia === 'vencido'
      ? AlertTriangle
      : aviso.urgencia === 'critico'
        ? Clock
        : FileWarning;

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border p-3 ${estilo.caja}`}>
      <Icono className={`mt-0.5 size-4 shrink-0 ${estilo.icono}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{aviso.titulo}</p>
        <p className="text-xs text-muted-foreground">{aviso.detalle}</p>
      </div>
    </div>
  );
}
