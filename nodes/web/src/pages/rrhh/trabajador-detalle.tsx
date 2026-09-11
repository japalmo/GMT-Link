import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  FileText,
  FolderOpen,
  IdCard,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import type { HrAlerta, HrWorkerSummary } from '@gmt-platform/contracts';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getHrSummary } from '@/lib/api';
import { PersonAvatar } from '@/pages/directorio/person-avatar';
import { UserDocumentsTab } from '@/pages/usuarios/user-documents-tab';
import { UserScheduleTab } from '@/pages/usuarios/user-schedule-tab';
import { AcreditacionesSeccion, ExamenesTab, InduccionesTab } from './registros';
import { HhGrafico } from './hh-grafico';
import { EtiquetaVigencia, fechaCorta, type FichaTab } from './rrhh-shared';

/**
 * Ficha del trabajador, con la misma forma que el detalle de un activo en
 * Recursos: cabecera con la identificación y el contexto, y pestañas debajo.
 *
 * El Resumen es de SOLO LECTURA a propósito. Es la vista que se abre para
 * responder "¿cómo está este trabajador?", y mezclar ahí formularios de edición
 * invita a tocar un dato mientras se consulta otro. Las alertas llevan a la
 * pestaña donde sí se gestiona.
 */

const TABS: ReadonlyArray<TabItem<FichaTab>> = [
  { value: 'resumen', label: 'Resumen', icon: IdCard },
  { value: 'datos', label: 'Datos personales', icon: UserRound },
  { value: 'documentos', label: 'Documentos', icon: FolderOpen },
  { value: 'examenes', label: 'Exámenes', icon: Stethoscope },
  { value: 'inducciones', label: 'Inducciones', icon: FileText },
];

/** A qué pestaña lleva cada clase de alerta. */
const TAB_DE_ALERTA: Record<HrAlerta['tipo'], FichaTab> = {
  DOCUMENTO: 'documentos',
  EXAMEN: 'examenes',
  INDUCCION: 'inducciones',
  ACREDITACION: 'datos',
};

export function TrabajadorDetalle({
  userId,
  puedeEditar,
  onVolver,
}: {
  userId: string;
  puedeEditar: boolean;
  onVolver: () => void;
}): ReactNode {
  const [tab, setTab] = useState<FichaTab>('resumen');
  const [resumen, setResumen] = useState<HrWorkerSummary | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idBase = useId();

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    getHrSummary(userId)
      .then(setResumen)
      .catch((err) => setError(errorToMessage(err, 'No se pudo cargar la ficha.')))
      .finally(() => setCargando(false));
  }, [userId]);

  useEffect(cargar, [cargar]);

  if (cargando) return <LoadingState rows={6} label="Cargando la ficha…" />;
  if (error || !resumen) return <ErrorState message={error ?? 'Ficha no disponible.'} />;

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" onClick={onVolver} className="self-start">
        <ArrowLeft className="mr-1 size-4" aria-hidden />
        Volver al directorio
      </Button>

      <header className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-4">
        <PersonAvatar
          firstName={resumen.firstName}
          lastName={resumen.lastName}
          avatarUrl={resumen.avatarUrl}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">
            {resumen.firstName} {resumen.lastName}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {/* El CARGO es el puesto laboral. No es el rol de acceso a la
                plataforma, que se administra en Usuarios. */}
            {resumen.cargo ?? 'Sin cargo declarado'}
            {' · '}
            {resumen.isFieldWorker ? 'Trabajador de faena, sin cuenta' : resumen.email}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Turno</p>
            <p className="font-medium">{resumenTurno(resumen)}</p>
          </div>
          {resumen.alertas.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              <AlertTriangle className="size-4" aria-hidden />
              {resumen.alertas.length}{' '}
              {resumen.alertas.length === 1 ? 'requisito por atender' : 'requisitos por atender'}
            </span>
          )}
        </div>
      </header>

      <Tabs<FichaTab>
        aria-label="Secciones de la ficha"
        items={TABS}
        value={tab}
        onValueChange={setTab}
        idBase={idBase}
      />

      <div
        role="tabpanel"
        id={tabPanelId(idBase, tab)}
        aria-labelledby={tabTriggerId(idBase, tab)}
        tabIndex={0}
      >
        {tab === 'resumen' && (
          <div className="flex flex-col gap-4">
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Datos básicos</h3>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <Dato rotulo="Nombre" valor={`${resumen.firstName} ${resumen.lastName}`} />
                  <Dato rotulo="Cargo" valor={resumen.cargo ?? 'Sin declarar'} />
                  <Dato
                    rotulo="Correo"
                    valor={resumen.isFieldWorker ? 'Sin cuenta en la plataforma' : resumen.email}
                  />
                  <Dato rotulo="Turno" valor={resumenTurno(resumen)} />
                  <Dato rotulo="Documentos" valor={`${resumen.conteos.documentos} cargados`} />
                  <Dato rotulo="Exámenes" valor={`${resumen.conteos.examenes} cargados`} />
                  <Dato rotulo="Inducciones" valor={`${resumen.conteos.inducciones} cargadas`} />
                </dl>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="size-4 opacity-70" aria-hidden />
                  Acreditaciones
                </h3>
                {resumen.accreditations.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin acreditaciones registradas. Se cargan en Datos personales.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {resumen.accreditations.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.clientName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {a.faenaName ?? 'Todas sus faenas'} · vence {fechaCorta(a.expiresAt)}
                          </span>
                        </span>
                        <EtiquetaVigencia vigencia={a.vigencia} diasRestantes={a.diasRestantes} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 opacity-70" aria-hidden />
                Requisitos vencidos o por vencer
              </h3>
              {resumen.alertas.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nada vencido ni por vencer en los próximos 30 días, entre lo que está cargado.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-border">
                  {resumen.alertas.map((a) => (
                    <li key={`${a.tipo}-${a.id}`} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{a.nombre}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {ETIQUETA_TIPO[a.tipo]}
                          {a.clientName ? ` · ${a.clientName}` : ''}
                          {a.faenaName ? ` · ${a.faenaName}` : ''} · vence {fechaCorta(a.expiresAt)}
                        </span>
                      </span>
                      <EtiquetaVigencia vigencia={a.vigencia} diasRestantes={a.diasRestantes} />
                      <Button size="sm" variant="outline" onClick={() => setTab(TAB_DE_ALERTA[a.tipo])}>
                        Ir a {ETIQUETA_TIPO[a.tipo].toLowerCase()}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <HhGrafico userId={userId} />
          </div>
        )}

        {tab === 'datos' && (
          <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="size-4 opacity-70" aria-hidden />
                Turno
              </h3>
              <div className="mt-3">
                <UserScheduleTab userId={userId} />
              </div>
            </section>
            <AcreditacionesSeccion
              userId={userId}
              puedeEditar={puedeEditar}
              onCambio={cargar}
            />
          </div>
        )}

        {tab === 'documentos' && <UserDocumentsTab userId={userId} />}
        {tab === 'examenes' && <ExamenesTab userId={userId} puedeEditar={puedeEditar} />}
        {tab === 'inducciones' && <InduccionesTab userId={userId} puedeEditar={puedeEditar} />}
      </div>
    </div>
  );
}

const ETIQUETA_TIPO: Record<HrAlerta['tipo'], string> = {
  DOCUMENTO: 'Documento',
  EXAMEN: 'Examen',
  INDUCCION: 'Inducción',
  ACREDITACION: 'Acreditación',
};

function Dato({ rotulo, valor }: { rotulo: string; valor: string }): ReactNode {
  return (
    <>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </>
  );
}

/** Turno en una línea, igual que en el directorio. */
function resumenTurno(r: HrWorkerSummary): string {
  if (!r.turno) return 'Sin cargar';
  const jornada = r.turno.dayNight === 'NOCHE' ? 'noche' : 'día';
  if (r.turno.shiftPattern === 'ADMINISTRATIVO') return 'Administrativo';
  if (r.turno.workDays && r.turno.restDays) {
    return `${r.turno.workDays}x${r.turno.restDays} ${jornada}`;
  }
  return `Turno ${jornada}`;
}
