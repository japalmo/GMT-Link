import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import type { HrPersonRow, HrRequirementRow } from '@gmt-platform/contracts';
import { DataTable, type DataTableColumn } from '@/components/primitives/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDataTable } from '@/hooks/use-data-table';
import { useClients } from '@/hooks/use-clients';
import { useFaenas } from '@/hooks/use-faenas';
import { fetchHrPeople, fetchHrRequirements } from '@/lib/api';
import {
  hayFiltros,
  listaDe,
  type ClaveFiltro,
  type EstadoConsulta,
  type ModoConsulta,
} from './consulta-estado';
import {
  EtiquetaVigencia,
  fechaCorta,
  fechaIsoLocal,
  plural,
  TIPO_REQUISITO,
  TIPOS_REQUISITO,
  TURNOS,
  VIGENCIA,
  VIGENCIAS,
  type FichaTab,
} from './rrhh-shared';

/**
 * Consulta de RRHH: la misma búsqueda vista de dos formas.
 *
 * Por requisito responde "qué vence y de quién"; por persona responde "quién
 * tiene algo pendiente". Los filtros son los mismos y viven en la URL, así que
 * cambiar de vista no los pierde.
 *
 * Usa el motor de tablas de la plataforma (orden y paginación en el servidor).
 * Los filtros propios se pasan en el fetcher y el `resetKey` recarga desde la
 * página 1 cada vez que cambian.
 */

const RANGOS = [30, 60, 90] as const;

export function ConsultaRrhh({
  consulta,
  onConsulta,
  onAbrir,
  version,
}: {
  consulta: EstadoConsulta;
  onConsulta: (c: EstadoConsulta) => void;
  onAbrir: (userId: string, tab?: FichaTab) => void;
  version: number;
}): ReactNode {
  const filtrosApi: Record<string, string> = {};
  for (const [k, v] of Object.entries(consulta.filtros)) if (v) filtrosApi[k] = v;
  const clave = JSON.stringify([consulta.q.trim(), filtrosApi]);

  const [conteoReq, setConteoReq] = useState<{ filas: number; personas: number } | null>(null);
  const [conteoPer, setConteoPer] = useState<{ filas: number; requisitos: number } | null>(null);

  const requisitos = useDataTable<HrRequirementRow>(
    (req) =>
      fetchHrRequirements({ ...req, search: consulta.q.trim() || undefined, filters: filtrosApi }).then(
        (p) => {
          setConteoReq({ filas: p.total, personas: p.people });
          return p;
        },
      ),
    {
      initialPageSize: 25,
      initialSortDir: 'asc',
      enabled: consulta.modo === 'requisitos',
      resetKey: `r:${clave}`,
    },
  );

  const personas = useDataTable<HrPersonRow>(
    (req) =>
      fetchHrPeople({ ...req, search: consulta.q.trim() || undefined, filters: filtrosApi }).then((p) => {
        setConteoPer({ filas: p.total, requisitos: p.requirements });
        return p;
      }),
    {
      initialPageSize: 25,
      initialSortDir: 'asc',
      enabled: consulta.modo === 'personas',
      resetKey: `p:${clave}`,
    },
  );

  // Al volver de una ficha se recarga en la misma página: lo editado tiene que
  // verse, pero sin perder dónde estaba quien consultaba.
  const { refetch: refetchReq } = requisitos;
  const { refetch: refetchPer } = personas;
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    refetchReq();
    refetchPer();
  }, [version, refetchReq, refetchPer]);

  // Búsqueda con demora: escribir no debe recargar la tabla en cada tecla.
  const [texto, setTexto] = useState(consulta.q);
  const ultima = useRef({ consulta, onConsulta });
  ultima.current = { consulta, onConsulta };
  useEffect(() => {
    setTexto(consulta.q);
  }, [consulta.q]);
  useEffect(() => {
    if (texto === ultima.current.consulta.q) return;
    const t = setTimeout(() => {
      ultima.current.onConsulta({ ...ultima.current.consulta, q: texto });
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  const { clients } = useClients();
  const { faenas } = useFaenas(consulta.filtros.cliente);

  function fijar(cambios: Partial<Record<ClaveFiltro, string | undefined>>): void {
    const filtros = { ...consulta.filtros };
    for (const [k, v] of Object.entries(cambios) as Array<[ClaveFiltro, string | undefined]>) {
      if (v) filtros[k] = v;
      else delete filtros[k];
    }
    // Una faena es de un cliente: cambiar de cliente la deja sin sentido.
    if ('cliente' in cambios) delete filtros.faena;
    onConsulta({ ...consulta, filtros });
  }

  function alternar(k: 'tipo' | 'vigencia', valor: string): void {
    const actual = listaDe(consulta.filtros[k]);
    const next = actual.includes(valor) ? actual.filter((x) => x !== valor) : [...actual, valor];
    fijar({ [k]: next.join(',') || undefined });
  }

  function modo(m: ModoConsulta): void {
    onConsulta({ ...consulta, modo: m });
  }

  const tipos = listaDe(consulta.filtros.tipo);
  const vigencias = listaDe(consulta.filtros.vigencia);
  const hoy = fechaIsoLocal();
  const hayRango = Boolean(consulta.filtros.desde || consulta.filtros.hasta);

  const contador =
    consulta.modo === 'requisitos'
      ? conteoReq &&
        `${plural(conteoReq.filas, 'requisito', 'requisitos')} de ${plural(conteoReq.personas, 'persona', 'personas')}`
      : conteoPer &&
        `${plural(conteoPer.filas, 'persona', 'personas')} · ${plural(conteoPer.requisitos, 'requisito', 'requisitos')}`;

  const columnasRequisitos: ReadonlyArray<DataTableColumn<HrRequirementRow>> = [
    {
      id: 'trabajador',
      header: 'Trabajador',
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {r.firstName} {r.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.cargo ?? 'Sin cargo declarado'}
            {r.isFieldWorker ? ' · de faena' : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'tipo',
      header: 'Tipo',
      sortable: true,
      render: (r) => {
        const t = TIPO_REQUISITO[r.tipo];
        const Icono = t.icon;
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
            <Icono className="size-4" aria-hidden />
            {t.label}
          </span>
        );
      },
    },
    {
      id: 'nombre',
      header: 'Requisito',
      sortable: true,
      render: (r) => {
        const extra = [r.detalle, r.tipo === 'ACREDITACION' ? null : r.clientName, r.faenas]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="min-w-0 max-w-[22rem]">
            <p className="truncate">{r.nombre}</p>
            {extra && <p className="truncate text-xs text-muted-foreground">{extra}</p>}
          </div>
        );
      },
    },
    {
      id: 'vencimiento',
      header: 'Vence',
      sortable: true,
      render: (r) => <span className="whitespace-nowrap tabular-nums">{fechaCorta(r.expiresAt)}</span>,
    },
    {
      id: 'vigencia',
      header: 'Vigencia',
      sortable: true,
      render: (r) => <EtiquetaVigencia vigencia={r.vigencia} diasRestantes={r.diasRestantes} />,
    },
    {
      id: 'estado',
      header: 'Estado del registro',
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{r.estadoRegistro ?? '—'}</span>
      ),
    },
  ];

  const columnasPersonas: ReadonlyArray<DataTableColumn<HrPersonRow>> = [
    {
      id: 'trabajador',
      header: 'Trabajador',
      sortable: true,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {p.firstName} {p.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {p.cargo ?? 'Sin cargo declarado'}
            {p.isFieldWorker ? ' · de faena, sin cuenta' : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'turno',
      header: 'Turno',
      render: (p) =>
        p.turno ?? <span className="italic text-muted-foreground">Sin cargar</span>,
    },
    {
      id: 'vencidos',
      header: 'Vencidos',
      sortable: true,
      className: 'text-right',
      render: (p) => (
        <span
          className={`tabular-nums ${p.vencidos > 0 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}
        >
          {p.vencidos}
        </span>
      ),
    },
    {
      id: 'porVencer',
      header: 'Por vencer',
      sortable: true,
      className: 'text-right',
      render: (p) => (
        <span
          className={`tabular-nums ${p.porVencer > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
        >
          {p.porVencer}
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Requisitos',
      sortable: true,
      className: 'text-right',
      render: (p) => <span className="tabular-nums">{p.total}</span>,
    },
    {
      id: 'urgentes',
      header: 'Lo más urgente',
      render: (p) =>
        p.requisitos.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nada cargado</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.requisitos.slice(0, 2).map((r) => (
              <span key={r.key} className="inline-flex items-center gap-1.5 text-xs">
                <span className="max-w-[10rem] truncate">{r.nombre}</span>
                <EtiquetaVigencia vigencia={r.vigencia} diasRestantes={r.diasRestantes} />
              </span>
            ))}
            {p.requisitos.length > 2 && (
              <span className="text-xs text-muted-foreground">y {p.requisitos.length - 2} más</span>
            )}
          </div>
        ),
    },
  ];

  const chip = (activo: boolean): string =>
    `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      activo
        ? 'border-primary bg-primary/10 font-medium text-foreground'
        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Cómo mostrar la consulta"
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {(
              [
                ['requisitos', 'Por requisito'],
                ['personas', 'Por persona'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={consulta.modo === valor}
                onClick={() => modo(valor)}
                className={`rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  consulta.modo === valor
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar trabajador por nombre, cargo o correo…"
              className="pl-8"
              aria-label="Buscar trabajador"
            />
          </div>

          <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
            {contador ?? ''}
          </span>
          {hayFiltros(consulta) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onConsulta({ modo: consulta.modo, q: '', filtros: {} })}
            >
              <X className="mr-1 size-4" aria-hidden />
              Limpiar filtros
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Turno">
            <Select
              aria-label="Filtrar por turno"
              value={consulta.filtros.turno ?? ''}
              onChange={(e) => fijar({ turno: e.target.value })}
              className="w-[170px]"
            >
              <option value="">Todos</option>
              {TURNOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Cliente">
            <Select
              aria-label="Filtrar por cliente"
              value={consulta.filtros.cliente ?? ''}
              onChange={(e) => fijar({ cliente: e.target.value })}
              className="w-[170px]"
            >
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Faena">
            <Select
              aria-label="Filtrar por faena"
              value={consulta.filtros.faena ?? ''}
              onChange={(e) => fijar({ faena: e.target.value })}
              disabled={!consulta.filtros.cliente}
              className="w-[170px]"
              title={consulta.filtros.cliente ? undefined : 'Elige primero el cliente'}
            >
              <option value="">{consulta.filtros.cliente ? 'Todas' : 'Elige un cliente'}</option>
              {faenas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Vence desde">
            <Input
              type="date"
              aria-label="Vence desde"
              value={consulta.filtros.desde ?? ''}
              onChange={(e) => fijar({ desde: e.target.value })}
              className="w-[150px]"
            />
          </Campo>
          <Campo etiqueta="hasta">
            <Input
              type="date"
              aria-label="Vence hasta"
              value={consulta.filtros.hasta ?? ''}
              onChange={(e) => fijar({ hasta: e.target.value })}
              className="w-[150px]"
            />
          </Campo>
          <div className="flex items-center gap-1.5 pb-1">
            {RANGOS.map((d) => {
              const hasta = fechaIsoLocal(d);
              const activo = consulta.filtros.desde === hoy && consulta.filtros.hasta === hasta;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={activo}
                  onClick={() =>
                    activo ? fijar({ desde: undefined, hasta: undefined }) : fijar({ desde: hoy, hasta })
                  }
                  className={chip(activo)}
                >
                  Próximos {d} días
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tipo de requisito">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Tipo</span>
            {TIPOS_REQUISITO.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipos.includes(t)}
                onClick={() => alternar('tipo', t)}
                className={chip(tipos.includes(t))}
              >
                {TIPO_REQUISITO[t].plural}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Vigencia">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Vigencia</span>
            {VIGENCIAS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vigencias.includes(v)}
                onClick={() => alternar('vigencia', v)}
                className={chip(vigencias.includes(v))}
              >
                {VIGENCIA[v].label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4"
              checked={consulta.filtros.habilitante === '1'}
              onChange={(e) => fijar({ habilitante: e.target.checked ? '1' : undefined })}
            />
            Solo lo que habilita hoy
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4"
              checked={consulta.filtros.sinCargo === '1'}
              onChange={(e) => fijar({ sinCargo: e.target.checked ? '1' : undefined })}
            />
            Sin cargo declarado
          </label>
        </div>

        {(hayRango || consulta.filtros.cliente) && (
          <p className="text-xs text-muted-foreground">
            {hayRango && 'El rango de vencimiento deja fuera lo que no tiene fecha cargada. '}
            {consulta.filtros.cliente &&
              'Al filtrar por cliente solo aparecen inducciones y acreditaciones: los documentos y exámenes no son de un cliente.'}
          </p>
        )}
      </div>

      {consulta.modo === 'requisitos' ? (
        <DataTable<HrRequirementRow>
          table={requisitos}
          columns={columnasRequisitos}
          getRowId={(r) => r.key}
          onRowClick={(r) => onAbrir(r.userId, TIPO_REQUISITO[r.tipo].tab)}
          caption="Requisitos de los trabajadores"
          emptyMessage={
            hayFiltros(consulta)
              ? 'Ningún requisito cumple estos filtros.'
              : 'Todavía no hay requisitos cargados.'
          }
        />
      ) : (
        <DataTable<HrPersonRow>
          table={personas}
          columns={columnasPersonas}
          getRowId={(p) => p.userId}
          onRowClick={(p) => onAbrir(p.userId)}
          caption="Trabajadores y sus requisitos"
          emptyMessage="Nadie cumple estos filtros."
        />
      )}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{etiqueta}</span>
      {children}
    </div>
  );
}
