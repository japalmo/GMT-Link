import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Download,
  ExternalLink,
  HardHat,
  Loader2,
  MapPin,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { HseIncidentDetail, HseIncidentRow } from '@gmt-platform/contracts';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';
import { useHasPermission } from '@/hooks/use-has-permission';
import { DataTable, type DataTableColumn } from '@/components/primitives/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import {
  deleteHseIncident,
  errorToMessage,
  fetchHseIncidentPdf,
  fetchHseIncidents,
  getHseIncident,
} from '@/lib/api';

/**
 * HSE — historial de reportes de incidente.
 *
 * Los reportes entran por un enlace público que se llena desde el celular en
 * terreno; acá se consultan. El PDF se arma con el formato impreso de siempre
 * (GMT-SGC-SG-INC-FR-01), así que el que se baja de la plataforma es el mismo
 * documento que se archiva.
 */

const ENLACE_PUBLICO = '/public/incidente';

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}-${m}-${a}` : iso;
}

export default function HsePage(): ReactNode {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<HseIncidentRow | null>(null);
  // Consultar el historial y vaciarlo son cosas distintas: el botón de borrar
  // solo existe para quien tiene el permiso de gestión.
  const puedeBorrar = useHasPermission('hse:manage');

  const tabla = useDataTable<HseIncidentRow>((req) => fetchHseIncidents(req), {
    initialPageSize: 20,
    initialSortBy: 'fecha',
    initialSortDir: 'desc',
  });

  async function descargar(fila: HseIncidentRow): Promise<void> {
    setDescargando(fila.id);
    try {
      const blob = await fetchHseIncidentPdf({ id: fila.id });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fila.code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo descargar el reporte.'));
    } finally {
      setDescargando(null);
    }
  }

  async function borrar(fila: HseIncidentRow): Promise<void> {
    try {
      await deleteHseIncident(fila.id);
      toast.success(`Reporte ${fila.code} borrado.`);
      tabla.refetch();
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo borrar el reporte.'));
    } finally {
      setBorrando(null);
    }
  }

  async function copiarEnlace(): Promise<void> {
    const url = `${window.location.origin}${ENLACE_PUBLICO}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado. Compártelo con quien reporta en terreno.');
    } catch {
      toast.error(`Copia el enlace a mano: ${url}`);
    }
  }

  const columnas: ReadonlyArray<DataTableColumn<HseIncidentRow>> = [
    {
      id: 'codigo',
      header: 'Registro',
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    {
      id: 'fecha',
      header: 'Ocurrió',
      sortable: true,
      render: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {fechaCorta(r.occurredOn)} · {r.occurredAt}
        </span>
      ),
    },
    {
      id: 'lugar',
      header: 'Lugar',
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.sitio ?? 'Sin sitio'}</p>
          {r.area && <p className="truncate text-xs text-muted-foreground">{r.area}</p>}
        </div>
      ),
    },
    {
      id: 'consecuencias',
      header: 'Consecuencias',
      render: (r) =>
        r.consecuencias.length === 0 ? (
          <span className="text-xs text-muted-foreground">Sin marcar</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.consecuencias.map((c) => (
              <Badge key={c} variant="outline" className="text-[11px]">
                {c}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      id: 'resumen',
      header: 'Qué pasó',
      className: 'max-w-[26rem]',
      render: (r) => <p className="truncate text-muted-foreground">{r.resumen}</p>,
    },
    {
      id: 'prepara',
      header: 'Reporta',
      sortable: true,
      render: (r) => <span className="whitespace-nowrap">{r.preparaNombre}</span>,
    },
  ];

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="HSE"
        description="Reportes de incidente enviados desde terreno, con su formato original."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldAlert className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Formulario público de incidentes</p>
          <p className="text-xs text-muted-foreground">
            Cualquiera con el enlace puede reportar desde su teléfono, sin cuenta. Al enviarlo, el
            PDF se descarga y el reporte aparece acá.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void copiarEnlace()}>
            <Copy className="mr-1 size-4" aria-hidden />
            Copiar enlace
          </Button>
          <a
            href={ENLACE_PUBLICO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="mr-1 size-4" aria-hidden />
            Abrir
          </a>
        </div>
      </div>

      <DataTable<HseIncidentRow>
        table={tabla}
        columns={columnas}
        getRowId={(r) => r.id}
        searchable
        searchPlaceholder="Buscar por registro, lugar, descripción…"
        onRowClick={(r) => setAbierto(r.id)}
        caption="Reportes de incidente"
        emptyMessage="Todavía no hay reportes de incidente."
        rowActions={(r) => (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={descargando === r.id}
              onClick={(e) => {
                e.stopPropagation();
                void descargar(r);
              }}
            >
              {descargando === r.id ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-1 size-3.5" aria-hidden />
              )}
              PDF
            </Button>
            {puedeBorrar && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Borrar el reporte ${r.code}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setBorrando(r);
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            )}
          </>
        )}
      />

      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(v) => !v && setBorrando(null)}
        title="Borrar el reporte"
        description={
          borrando
            ? `Se borra ${borrando.code} con sus ${borrando.fotos === 1 ? 'foto' : `${borrando.fotos} fotos`} y su PDF. No se puede deshacer, y el número queda libre para el próximo reporte.`
            : ''
        }
        confirmLabel="Borrar"
        onConfirm={async () => {
          if (borrando) await borrar(borrando);
        }}
      />

      <DetalleIncidente id={abierto} onCerrar={() => setAbierto(null)} />
    </PageContainer>
  );
}

function DetalleIncidente({
  id,
  onCerrar,
}: {
  id: string | null;
  onCerrar: () => void;
}): ReactNode {
  const [detalle, setDetalle] = useState<HseIncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!id) return;
    setDetalle(null);
    setError(null);
    getHseIncident(id)
      .then(setDetalle)
      .catch((err) => setError(errorToMessage(err, 'No se pudo cargar el reporte.')));
  }, [id]);

  useEffect(cargar, [cargar]);

  return (
    <Modal open={id !== null} onOpenChange={(v) => !v && onCerrar()}>
      <ModalContent>
        <div className="flex flex-col gap-4">
          <ModalHeader>
            <ModalTitle>{detalle ? `Reporte ${detalle.code}` : 'Reporte de incidente'}</ModalTitle>
          </ModalHeader>

          {error ? (
            <ErrorState message={error} onRetry={cargar} />
          ) : !detalle ? (
            <LoadingState rows={4} label="Cargando el reporte…" />
          ) : (
            <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1">
              <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Dato
                  rotulo="Ocurrió"
                  valor={`${fechaCorta(detalle.occurredOn)} · ${detalle.occurredAt}`}
                />
                <Dato rotulo="Turno" valor={detalle.turno ?? 'Sin registrar'} />
                <Dato rotulo="Sitio" valor={detalle.sitio ?? 'Sin registrar'} />
                <Dato rotulo="Área" valor={detalle.area ?? 'Sin registrar'} />
                {detalle.latitude !== null && detalle.longitude !== null && (
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Punto en el mapa</span>
                    <a
                      href={`https://www.google.com/maps?q=${detalle.latitude},${detalle.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <MapPin className="size-3.5" aria-hidden />
                      {detalle.latitude.toFixed(5)}, {detalle.longitude.toFixed(5)}
                    </a>
                  </div>
                )}
                <Dato rotulo="Empresa" valor={detalle.empresa} />
                <Dato
                  rotulo="Tiempo perdido"
                  valor={
                    detalle.tiempoPerdido === 'CON'
                      ? 'Con tiempo perdido'
                      : detalle.tiempoPerdido === 'SIN'
                        ? 'Sin tiempo perdido'
                        : 'No se indicó'
                  }
                />
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Consecuencias
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {consecuenciasDe(detalle).map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                  {consecuenciasDe(detalle).length === 0 && (
                    <span className="text-sm text-muted-foreground">Ninguna marcada.</span>
                  )}
                </div>
                <Detalles detalle={detalle} />
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Descripción
                </h3>
                <p className="whitespace-pre-line text-sm">{detalle.descripcion}</p>
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Acciones inmediatas
                </h3>
                <p className="whitespace-pre-line text-sm">{detalle.accionesInmediatas}</p>
              </section>

              {detalle.fotos.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fotos
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {detalle.fotos.map((url, i) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-square overflow-hidden rounded-md border border-border"
                      >
                        <img
                          src={url}
                          alt={`Foto ${i + 1} del incidente ${detalle.code}`}
                          className="size-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              <section className="flex items-center gap-2 border-t border-border pt-3 text-sm">
                <HardHat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  Reportado por <span className="font-medium">{detalle.preparaNombre}</span>
                  {detalle.preparaCargo ? `, ${detalle.preparaCargo}` : ''} ·{' '}
                  {fechaCorta(detalle.preparedOn)}
                </span>
              </section>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

function Dato({ rotulo, valor }: { rotulo: string; valor: string }): ReactNode {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="font-medium">{valor}</span>
    </div>
  );
}

function consecuenciasDe(d: HseIncidentDetail): string[] {
  const marcadas: string[] = [];
  if (d.lesionPersonas) marcadas.push('Lesión a personas');
  if (d.danoInfraestructura) marcadas.push('Daño a infraestructura / equipo');
  if (d.fugaDerrame) marcadas.push('Fuga / derrame');
  if (d.emisionesAire) marcadas.push('Emisiones al aire');
  if (d.instalaciones) marcadas.push('Instalaciones (robos, hurtos)');
  if (d.cuasiAccidente) marcadas.push('Cuasi accidente');
  if (d.procesoAfectado) marcadas.push('Proceso o área afectado');
  return marcadas;
}

/** Los detalles que acompañan a cada consecuencia, cuando vienen. */
function Detalles({ detalle }: { detalle: HseIncidentDetail }): ReactNode {
  const filas: Array<[string, string]> = [];
  if (detalle.cargoLesionado) filas.push(['Cargo del lesionado', detalle.cargoLesionado]);
  if (detalle.danoDetalle) filas.push(['Qué se dañó', detalle.danoDetalle]);
  if (detalle.fugaSustancia) filas.push(['Sustancia', detalle.fugaSustancia]);
  if (detalle.fugaDuracionMin !== null)
    filas.push(['Duración fuga', `${detalle.fugaDuracionMin} min`]);
  if (detalle.fugaVolumenM3 !== null)
    filas.push(['Volumen derramado', `${detalle.fugaVolumenM3} m3`]);
  if (detalle.fugaPh !== null) filas.push(['pH', String(detalle.fugaPh)]);
  if (detalle.fugaSuperficieM2 !== null)
    filas.push(['Superficie', `${detalle.fugaSuperficieM2} m2`]);
  if (detalle.emisionGases) filas.push(['Gases', detalle.emisionGases]);
  if (detalle.emisionDuracionMin !== null)
    filas.push(['Duración emisión', `${detalle.emisionDuracionMin} min`]);
  if (detalle.instalacionesLugar) filas.push(['Lugar específico', detalle.instalacionesLugar]);
  if (filas.length === 0) return null;
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
