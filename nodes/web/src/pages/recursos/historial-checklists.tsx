import { type ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ChecklistAnswer,
  ChecklistSubmissionView,
  ChecklistTemplateView,
} from '@/types/assets';
import { parseCommentMap } from './svg-checklist-input';

/**
 * Historial de checklists del activo.
 *
 * La vista por defecto es COMPRIMIDA: conductor, kilometraje y fecha, que es lo
 * que alguien recorre cuando busca un checklist puntual entre cientos. El
 * detalle completo se despliega bajo demanda, porque desplegado ocupa media
 * pantalla por envío y hacía imposible barrer la lista.
 */

/** Ítem de checklist que guarda el odómetro (mismo id que usa el backend). */
const ITEM_ODOMETRO = 'kilometraje';

const fmt = new Intl.NumberFormat('es-CL');

/** Kilometraje reportado en el checklist, o `null` si no vino o no es número. */
function odometroDe(answers: ReadonlyArray<ChecklistAnswer>): number | null {
  const ans = answers.find((a) => a.itemId === ITEM_ODOMETRO);
  if (!ans || ans.value === null || ans.value === undefined || ans.value === '') return null;
  const n = Number(ans.value);
  return Number.isFinite(n) ? n : null;
}

export interface HistorialChecklistsProps {
  submissions: ReadonlyArray<ChecklistSubmissionView>;
  template: ChecklistTemplateView | null;
  /** Marca una respuesta como falla según la plantilla (ESTADO con failOptions). */
  esFalla: (ans: ChecklistAnswer) => boolean;
  descargandoId: string | null;
  onDescargarPdf: (submissionId: string) => void;
}

export function HistorialChecklists({
  submissions,
  template,
  esFalla,
  descargandoId,
  onDescargarPdf,
}: HistorialChecklistsProps): ReactNode {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="size-4 text-primary" /> Historial de checklists
        </CardTitle>
        <CardDescription>
          {submissions.length === 0
            ? 'Todavía no hay checklists enviados para este activo.'
            : `${submissions.length} ${submissions.length === 1 ? 'checklist enviado' : 'checklists enviados'}. Despliega uno para ver todas sus respuestas.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {submissions.length === 0 ? (
          <p className="rounded border py-6 text-center text-xs text-muted-foreground">
            No hay reportes de checklist enviados anteriormente para este activo.
          </p>
        ) : (
          <div className="space-y-1.5">
            {submissions.map((sub) => (
              <FilaChecklist
                key={sub.id}
                sub={sub}
                template={template}
                esFalla={esFalla}
                descargando={descargandoId === sub.id}
                descargaBloqueada={descargandoId !== null}
                onDescargarPdf={onDescargarPdf}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilaChecklist({
  sub,
  template,
  esFalla,
  descargando,
  descargaBloqueada,
  onDescargarPdf,
}: {
  sub: ChecklistSubmissionView;
  template: ChecklistTemplateView | null;
  esFalla: (ans: ChecklistAnswer) => boolean;
  descargando: boolean;
  descargaBloqueada: boolean;
  onDescargarPdf: (submissionId: string) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const conFalla = sub.answers.some(esFalla);
  const km = odometroDe(sub.answers);
  const fecha = new Date(sub.createdAt);

  return (
    <div className={`rounded-lg border ${conFalla ? 'border-rose-500/20 bg-rose-500/5' : 'bg-card/30'}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent/40"
      >
        {abierto ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : 'Conductor desconocido'}
        </span>

        <span className="shrink-0 [font-variant-numeric:tabular-nums] text-muted-foreground">
          {km !== null ? `${fmt.format(km)} km` : 'sin km'}
        </span>

        {conFalla ? (
          <Badge className="shrink-0 border-rose-500/20 bg-rose-500/10 py-0 text-[10px] text-rose-400">
            Falla
          </Badge>
        ) : null}

        <span className="shrink-0 font-mono text-[10px] text-muted-foreground [font-variant-numeric:tabular-nums]">
          {fecha.toLocaleDateString('es-CL')}{' '}
          {fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>

      {abierto ? (
        <DetalleChecklist
          sub={sub}
          template={template}
          esFalla={esFalla}
          descargando={descargando}
          descargaBloqueada={descargaBloqueada}
          onDescargarPdf={onDescargarPdf}
        />
      ) : null}
    </div>
  );
}

function DetalleChecklist({
  sub,
  template,
  esFalla,
  descargando,
  descargaBloqueada,
  onDescargarPdf,
}: {
  sub: ChecklistSubmissionView;
  template: ChecklistTemplateView | null;
  esFalla: (ans: ChecklistAnswer) => boolean;
  descargando: boolean;
  descargaBloqueada: boolean;
  onDescargarPdf: (submissionId: string) => void;
}): ReactNode {
  // Observaciones companion cuyo texto ya viaja como `comment` del ESTADO padre
  // (envíos nuevos); se ocultan para no duplicar. Los envíos viejos que la
  // guardaron como respuesta propia se siguen mostrando.
  const obsRedundantes = new Set(
    sub.answers
      .filter((a) => typeof a.comment === 'string' && a.comment.trim() !== '')
      .map((a) => template?.items.find((it) => it.id === a.itemId)?.config?.obsItemId)
      .filter((v): v is string => Boolean(v)),
  );

  return (
    <div className="border-t border-border/40 px-3 pb-3 pt-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {sub.answers.map((ans, idx) => {
          if (obsRedundantes.has(ans.itemId)) return null;
          const tItem = template?.items.find((it) => it.id === ans.itemId);

          // Ítem SVG: el valor es el JSON del mapa de comentarios. Se muestra el
          // conteo y cada parte observada, no el JSON crudo.
          if (tItem?.type === 'SVG') {
            const entries = Object.values(
              parseCommentMap(typeof ans.value === 'string' ? ans.value : ''),
            );
            return (
              <div
                key={idx}
                className="flex flex-col gap-0.5 border-b border-border/20 pb-1 text-[11px] md:col-span-2"
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">{ans.label || ans.itemId}:</span>
                  <span className="font-semibold text-foreground">
                    {entries.length === 0
                      ? 'Sin observaciones'
                      : `${entries.length} ${entries.length === 1 ? 'observación' : 'observaciones'}`}
                  </span>
                </div>
                {entries.map((entry, i) => (
                  <span key={i} className="break-words italic text-muted-foreground">
                    {entry.part}: {entry.comment}
                  </span>
                ))}
              </div>
            );
          }

          const falla = esFalla(ans);
          const display =
            ans.value === true
              ? 'Sí'
              : ans.value === false
                ? 'No'
                : ans.value === null || ans.value === ''
                  ? 'Sin dato'
                  : String(ans.value);

          return (
            <div key={idx} className="flex flex-col gap-0.5 border-b border-border/20 pb-1 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-muted-foreground">{ans.label || ans.itemId}:</span>
                <span
                  className={`font-semibold ${
                    falla
                      ? 'text-rose-500'
                      : ans.value === true
                        ? 'text-emerald-500'
                        : 'text-foreground'
                  }`}
                >
                  {display}
                </span>
              </div>
              {typeof ans.comment === 'string' && ans.comment.trim() !== '' ? (
                <span className="break-words italic text-muted-foreground">Obs: {ans.comment}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={descargaBloqueada}
          onClick={() => onDescargarPdf(sub.id)}
        >
          <FileText className="mr-1.5 size-3" />
          {descargando ? 'Generando…' : 'Descargar PDF'}
        </Button>
      </div>
    </div>
  );
}
