import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Lock, LockOpen, RotateCcw, TriangleAlert } from 'lucide-react';
import type { AvanceObraEditable, AvanceSemanaEditable } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { CeldaEditable } from '@/components/ui/celda-editable';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { editarCorteAvance, editarSemanaAvance, errorToMessage } from '@/lib/api';
import { aFraccion, aPorcentaje, fechaCorta, formatoDelta, formatoPct } from './avance-comun';

type CampoPlan = 'parPlan' | 'acmPlan';
type CampoReal = 'parReal' | 'acmReal';

/**
 * El INFORME: una fila por semana con las columnas del documento.
 *
 * El real llega calculado desde las actividades. Se puede sobreescribir por
 * celda, y entonces la celda se marca y muestra el calculado al lado con la
 * diferencia: una segunda fuente que no se ve es la que se desincroniza.
 */
export function AvanceSemanas({
  projectId,
  datos,
  onCambio,
}: {
  projectId: string;
  datos: AvanceObraEditable;
  onCambio: () => Promise<void>;
}): ReactNode {
  const { semanas, puedeEditar } = datos;
  const [planAbierto, setPlanAbierto] = useState(false);
  const [confirmarPlan, setConfirmarPlan] = useState(false);

  const ultimaInformada = semanas.reduce(
    (m, s) => (s.acmReal !== null ? Math.max(m, s.index) : m),
    -1,
  );

  async function guardarPlan(
    s: AvanceSemanaEditable,
    campo: CampoPlan,
    pct: number,
  ): Promise<void> {
    await editarSemanaAvance(projectId, { code: s.code, [campo]: aFraccion(pct) });
    await onCambio();
  }

  async function guardarHh(s: AvanceSemanaEditable, hh: number): Promise<void> {
    await editarSemanaAvance(projectId, { code: s.code, hhPlan: hh });
    await onCambio();
  }

  async function sobreescribir(
    s: AvanceSemanaEditable,
    campo: CampoReal,
    pct: number,
  ): Promise<void> {
    const clave = campo === 'parReal' ? 'parRealOverride' : 'acmRealOverride';
    await editarSemanaAvance(projectId, { code: s.code, [clave]: aFraccion(pct) });
    await onCambio();
  }

  async function quitar(s: AvanceSemanaEditable, campo: CampoReal): Promise<void> {
    const clave = campo === 'parReal' ? 'parRealOverride' : 'acmRealOverride';
    try {
      await editarSemanaAvance(projectId, { code: s.code, [clave]: null });
      toast.success(`${s.code}: vuelve al valor calculado.`);
    } catch (e) {
      toast.error(errorToMessage(e, 'No se pudo quitar la sobreescritura.'));
    } finally {
      await onCambio();
    }
  }

  const editaPlan = puedeEditar && planAbierto;

  return (
    <div className="flex flex-col gap-4">
      <Corte
        projectId={projectId}
        datos={datos}
        ultimaInformada={ultimaInformada}
        onCambio={onCambio}
      />

      {puedeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">
            {planAbierto
              ? 'El plan está desbloqueado para edición.'
              : 'El plan es la línea base del contrato y está bloqueado.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (planAbierto ? setPlanAbierto(false) : setConfirmarPlan(true))}
          >
            {planAbierto ? <Lock className="mr-2 size-4" /> : <LockOpen className="mr-2 size-4" />}
            {planAbierto ? 'Bloquear el plan' : 'Editar el plan'}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Semana</th>
              <th className="px-2 py-2 text-left font-medium">Cierre</th>
              <th className="w-20 px-1 py-2 text-right font-medium">HH plan</th>
              <th className="w-20 px-1 py-2 text-right font-medium">PAR plan</th>
              <th className="w-32 px-1 py-2 text-right font-medium">PAR real</th>
              <th className="w-20 px-1 py-2 text-right font-medium">ACM plan</th>
              <th className="w-32 px-1 py-2 text-right font-medium">ACM real</th>
              <th className="w-16 px-2 py-2 text-right font-medium">Desv.</th>
            </tr>
          </thead>
          <tbody>
            {semanas.map((s, fila) => {
              // S-0 es el arranque (todo en cero) y una semana futura no tiene
              // real que sobreescribir: se admite solo hasta la próxima a cargar.
              const realEditable = puedeEditar && s.index >= 1 && s.index <= ultimaInformada + 1;
              const desviacion = s.acmReal !== null ? (s.acmReal - s.acmPlan) * 100 : null;
              return (
                <tr key={s.code} className="border-t border-border/60 align-top">
                  <td className="px-3 py-1.5 font-medium">{s.code}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{fechaCorta(s.closeDate)}</td>
                  <td className="px-0.5 py-0.5">
                    <CeldaHh
                      valor={s.hhPlan}
                      editable={editaPlan && s.index >= 1}
                      fila={fila}
                      onGuardar={(v) => guardarHh(s, v)}
                      etiqueta={`${s.code}, HH plan`}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <CeldaEditable
                      grupo="semanas"
                      fila={fila}
                      columna={1}
                      valor={aPorcentaje(s.parPlan)}
                      soloLectura={!editaPlan || s.index < 1}
                      aria-label={`${s.code}, PAR plan`}
                      onGuardar={(v) => guardarPlan(s, 'parPlan', v)}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <CeldaReal
                      semana={s}
                      campo="parReal"
                      fila={fila}
                      columna={2}
                      editable={realEditable}
                      onGuardar={(v) => sobreescribir(s, 'parReal', v)}
                      onQuitar={() => void quitar(s, 'parReal')}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <CeldaEditable
                      grupo="semanas"
                      fila={fila}
                      columna={3}
                      valor={aPorcentaje(s.acmPlan)}
                      soloLectura={!editaPlan || s.index < 1}
                      aria-label={`${s.code}, ACM plan`}
                      onGuardar={(v) => guardarPlan(s, 'acmPlan', v)}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <CeldaReal
                      semana={s}
                      campo="acmReal"
                      fila={fila}
                      columna={4}
                      editable={realEditable}
                      onGuardar={(v) => sobreescribir(s, 'acmReal', v)}
                      onQuitar={() => void quitar(s, 'acmReal')}
                    />
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums ${
                      desviacion === null
                        ? 'text-muted-foreground'
                        : desviacion < 0
                          ? 'text-destructive'
                          : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {desviacion === null ? '—' : formatoDelta(desviacion)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={confirmarPlan} onOpenChange={setConfirmarPlan}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>¿Editar el plan?</ModalTitle>
            <ModalDescription>
              El plan es la línea base contra la que se mide TODO el informe: la curva S, la
              desviación de cada semana y el semáforo del tablero. Cambiarlo mueve la referencia del
              contrato, no el avance de la obra.
            </ModalDescription>
          </ModalHeader>
          <p className="text-sm">
            Hazlo solo si el programa se reprogramó formalmente. Para registrar lo ejecutado se usa
            la tabla de actividades.
          </p>
          <ModalFooter>
            <Button variant="outline" onClick={() => setConfirmarPlan(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setPlanAbierto(true);
                setConfirmarPlan(false);
              }}
            >
              Sí, editar el plan
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/**
 * Real de una semana. Con sobreescritura se marca en ámbar y muestra debajo el
 * calculado y la diferencia, con un botón para volver a él.
 */
function CeldaReal({
  semana,
  campo,
  fila,
  columna,
  editable,
  onGuardar,
  onQuitar,
}: {
  semana: AvanceSemanaEditable;
  campo: CampoReal;
  fila: number;
  columna: number;
  editable: boolean;
  onGuardar: (pct: number) => Promise<void>;
  onQuitar: () => void;
}): ReactNode {
  const override = campo === 'parReal' ? semana.parRealOverride : semana.acmRealOverride;
  const calculado = campo === 'parReal' ? semana.parRealCalculado : semana.acmRealCalculado;
  const efectivo = semana[campo];
  const conOverride = override !== null;

  return (
    <div
      className={conOverride ? 'rounded-md bg-amber-500/10 ring-1 ring-amber-500/60' : undefined}
    >
      <CeldaEditable
        grupo="semanas"
        fila={fila}
        columna={columna}
        valor={aPorcentaje(efectivo)}
        soloLectura={!editable}
        aria-label={`${semana.code}, ${campo === 'parReal' ? 'PAR' : 'ACM'} real${conOverride ? ', sobreescrito' : ''}`}
        onGuardar={onGuardar}
      />
      {conOverride && (
        <div className="flex items-center justify-end gap-1 px-1 pb-0.5 text-[11px] text-amber-700 dark:text-amber-300">
          {calculado === null ? (
            // Sin detalle por actividad para esa semana no hay contra qué
            // comparar: pasa mientras el informe se carga solo en esta tabla.
            <span title="Ninguna actividad tiene cargado el avance de esta semana">
              sin detalle por actividad
            </span>
          ) : (
            <span className="whitespace-nowrap tabular-nums" title="Lo que sale de las actividades">
              calc. {formatoPct(aPorcentaje(calculado))} (
              {formatoDelta((override - calculado) * 100)})
            </span>
          )}
          {/* Sin calculado no hay a qué volver: quitarla dejaría la semana vacía y
              borraría del tablero un informe firmado. */}
          {editable && calculado !== null && (
            <button
              type="button"
              onClick={onQuitar}
              className="rounded p-0.5 hover:bg-amber-500/20"
              aria-label={`Quitar la sobreescritura del ${campo === 'parReal' ? 'PAR' : 'ACM'} real de ${semana.code} y volver al calculado`}
              title="Volver al calculado"
            >
              <RotateCcw className="size-3" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** HH plan: número libre (no porcentaje), así que no pasa por la celda de 0-100. */
function CeldaHh({
  valor,
  editable,
  fila,
  onGuardar,
  etiqueta,
}: {
  valor: number;
  editable: boolean;
  fila: number;
  onGuardar: (hh: number) => Promise<void>;
  etiqueta: string;
}): ReactNode {
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mostrado = valor.toLocaleString('es-CL', { maximumFractionDigits: 1 });

  if (!editable) {
    return (
      <span className="block px-2 py-1 text-right tabular-nums text-muted-foreground">
        {mostrado}
      </span>
    );
  }
  return (
    <input
      data-grupo="semanas"
      data-fila={fila}
      data-columna={0}
      aria-label={etiqueta}
      aria-invalid={error}
      inputMode="decimal"
      value={texto ?? String(Math.round(valor * 10) / 10)}
      onChange={(e) => setTexto(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (texto === null) return;
        const n = Number(texto.trim().replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
          setError(true);
          return;
        }
        setError(false);
        void onGuardar(n)
          .then(() => setTexto(null))
          .catch(() => setError(true));
      }}
      className={`w-full rounded-md border bg-transparent px-2 py-1 text-right tabular-nums outline-none focus:bg-card ${
        error
          ? 'border-destructive text-destructive'
          : 'border-transparent hover:border-border focus:border-primary'
      }`}
    />
  );
}

/**
 * Corte del informe vigente: la fecha y cuánto esperaba el programa ese día.
 *
 * Al cargar una semana nueva el real avanza; si el corte se quedara en el
 * informe anterior, el encabezado del tablero compararía el real nuevo contra el
 * plan viejo. Por eso avisa cuando hay real cargado MÁS ALLÁ del corte.
 */
function Corte({
  projectId,
  datos,
  ultimaInformada,
  onCambio,
}: {
  projectId: string;
  datos: AvanceObraEditable;
  ultimaInformada: number;
  onCambio: () => Promise<void>;
}): ReactNode {
  const [fecha, setFecha] = useState(datos.cutoffDate ?? '');
  const [plan, setPlan] = useState(
    // Con coma decimal, como el resto de la pantalla; al guardar se acepta ambas.
    datos.planAtCutoff === null
      ? ''
      : String(Math.round(datos.planAtCutoff * 10000) / 100).replace('.', ','),
  );
  const [guardando, setGuardando] = useState(false);

  // La semana que contiene el corte: la primera que cierra en o después de él.
  const semanaDelCorte = datos.cutoffDate
    ? datos.semanas.find((s) => s.closeDate >= (datos.cutoffDate ?? ''))
    : undefined;
  const ultima = datos.semanas.find((s) => s.index === ultimaInformada);
  const desfasado = semanaDelCorte !== undefined && ultimaInformada > semanaDelCorte.index;

  async function guardar(e: FormEvent): Promise<void> {
    e.preventDefault();
    const textoPlan = plan.trim().replace(',', '.');
    const pct = textoPlan === '' ? null : Number(textoPlan);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      toast.error('El plan al corte debe estar entre 0 y 100.');
      return;
    }
    setGuardando(true);
    try {
      await editarCorteAvance(projectId, {
        cutoffDate: fecha,
        planAtCutoff: pct === null ? null : aFraccion(pct),
      });
      toast.success('Corte actualizado.');
      await onCambio();
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo guardar el corte.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">Corte del informe</h3>
        <p className="text-xs text-muted-foreground">
          El encabezado del tablero compara el real contra el plan <em>a esta fecha</em>, que suele
          caer a media semana.
        </p>
      </div>

      {desfasado && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Hay real cargado hasta {ultima?.code}, pero el corte sigue en {semanaDelCorte.code}.
          Actualiza la fecha y el plan al corte, o el tablero comparará el real nuevo contra el plan
          viejo.
        </p>
      )}

      {datos.puedeEditar ? (
        <form onSubmit={(e) => void guardar(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="corte-fecha">Fecha de corte</Label>
            <Input
              id="corte-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
              className="w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="corte-plan">Plan al corte (%)</Label>
            <Input
              id="corte-plan"
              inputMode="decimal"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="Del programa"
              className="w-32 text-right tabular-nums"
            />
          </div>
          <Button type="submit" size="sm" disabled={guardando || fecha === ''}>
            {guardando ? 'Guardando…' : 'Guardar corte'}
          </Button>
        </form>
      ) : (
        <p className="text-sm">
          {datos.cutoffDate ? fechaCorta(datos.cutoffDate) : 'Sin corte'} · plan al corte{' '}
          {formatoPct(aPorcentaje(datos.planAtCutoff))}
        </p>
      )}
    </div>
  );
}
