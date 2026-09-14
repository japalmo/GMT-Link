import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Users } from 'lucide-react';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { useHasPermission } from '@/hooks/use-has-permission';
import { DirectorioView } from './directorio-view';
import { TableroView } from './tablero-view';
import { TrabajadorDetalle } from './trabajador-detalle';
import { escribirConsulta, leerConsulta, type EstadoConsulta } from './consulta-estado';
import { FICHA_TABS, type FichaTab, type RrhhTab } from './rrhh-shared';

/**
 * RRHH, antes "Directorio".
 *
 * Centraliza al trabajador y su habilitación para ir a faena. Dos pestañas: el
 * tablero, para ver la situación de todos sin abrir fichas, y el directorio,
 * para llegar a una persona concreta.
 *
 * La sección, la ficha abierta y los filtros de la consulta viven en la URL.
 * Las vistas quedan montadas (ocultas) mientras se mira una ficha: al volver,
 * la tabla sigue en la misma página, con el mismo orden y los mismos filtros.
 */

const TABS: ReadonlyArray<TabItem<RrhhTab>> = [
  { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { value: 'directorio', label: 'Directorio', icon: Users },
];

export default function RrhhPage(): ReactNode {
  const { tab: tabRuta } = useParams();
  const [sp, setSp] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const [version, setVersion] = useState(0);
  const idBase = useId();
  const scrollAlAbrir = useRef(0);

  // Consultar y editar son permisos distintos: quien solo consulta ve la ficha
  // completa pero sin botones de carga.
  const puedeEditar = useHasPermission('hr:manage');

  const seccionParam = sp.get('seccion');
  const seccion: RrhhTab =
    seccionParam === 'directorio' || seccionParam === 'dashboard'
      ? seccionParam
      : tabRuta === 'directorio'
        ? 'directorio'
        : 'dashboard';
  const persona = sp.get('persona');
  const pestanaParam = sp.get('pestana');
  const pestana: FichaTab = (FICHA_TABS as readonly string[]).includes(pestanaParam ?? '')
    ? (pestanaParam as FichaTab)
    : 'resumen';
  const consulta = useMemo(() => leerConsulta(sp), [sp]);

  // Una vista se monta la primera vez que se visita y ya no se desmonta.
  const montadas = useRef(new Set<RrhhTab>());
  montadas.current.add(seccion);

  const cambiar = useCallback(
    (fn: (n: URLSearchParams) => void, apilar = false) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          fn(n);
          return n;
        },
        { replace: !apilar },
      );
    },
    [setSp],
  );

  const onConsulta = useCallback(
    (c: EstadoConsulta) => cambiar((n) => escribirConsulta(n, c)),
    [cambiar],
  );

  function abrir(userId: string, tab?: FichaTab): void {
    scrollAlAbrir.current = window.scrollY;
    // Abrir una ficha SÍ apila historial: el botón Atrás del navegador vuelve a
    // la consulta, que es lo que cualquiera espera.
    cambiar((n) => {
      n.set('persona', userId);
      if (tab && tab !== 'resumen') n.set('pestana', tab);
      else n.delete('pestana');
    }, true);
  }

  function volver(): void {
    cambiar((n) => {
      n.delete('persona');
      n.delete('pestana');
    });
  }

  // Al cerrar la ficha: recalcular con lo editado y volver a donde se estaba.
  const habiaFicha = useRef(persona !== null);
  useEffect(() => {
    if (persona !== null) {
      habiaFicha.current = true;
      window.scrollTo({ top: 0 });
      return;
    }
    if (!habiaFicha.current) return;
    habiaFicha.current = false;
    setVersion((v) => v + 1);
    const y = scrollAlAbrir.current;
    const t = setTimeout(() => window.scrollTo({ top: y }), 0);
    return () => clearTimeout(t);
  }, [persona]);

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader
        title="RRHH"
        description="Trabajadores, antecedentes laborales y requisitos para ir a faena."
      />

      {persona !== null && (
        <TrabajadorDetalle
          key={`${persona}:${pestana}`}
          userId={persona}
          initialTab={pestana}
          puedeEditar={puedeEditar}
          volverLabel={seccion === 'dashboard' ? 'Volver al tablero' : 'Volver al directorio'}
          onVolver={volver}
        />
      )}

      <div hidden={persona !== null}>
        <Tabs<RrhhTab>
          aria-label="Secciones de RRHH"
          items={TABS}
          value={seccion}
          onValueChange={(t) =>
            cambiar((n) => {
              n.set('seccion', t);
            })
          }
          idBase={idBase}
        />

        <div
          role="tabpanel"
          id={tabPanelId(idBase, seccion)}
          aria-labelledby={tabTriggerId(idBase, seccion)}
          tabIndex={0}
          className="mt-4"
        >
          {montadas.current.has('dashboard') && (
            <div hidden={seccion !== 'dashboard'}>
              <TableroView
                consulta={consulta}
                onConsulta={onConsulta}
                onAbrir={abrir}
                version={version}
              />
            </div>
          )}
          {montadas.current.has('directorio') && (
            <div hidden={seccion !== 'directorio'}>
              <DirectorioView
                onAbrir={(id) => abrir(id)}
                busqueda={busqueda}
                onBusqueda={setBusqueda}
                version={version}
              />
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
