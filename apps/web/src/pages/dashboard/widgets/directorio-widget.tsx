import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Contact } from 'lucide-react';
import { ApiError, listDirectory } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WidgetShell } from './widget-shell';
import type { DirectoryEntry, RoleKey } from '@gtm-link/shared-types';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

const ROLE_LABELS: Record<RoleKey, string> = {
  org_admin: 'Admin Org.',
  department_admin: 'Admin Dept.',
  project_creator: 'Creador Proy.',
  operator: 'Operador',
  qa: 'QA / Calidad',
  finance: 'Finanzas',
  viewer: 'Visor',
  client_ito: 'Cliente ITO',
};

/**
 * Widget "Directorio" (§6-2.1). Cuenta las personas visibles para el usuario
 * (el backend ya scopea `GET /directory` por permisos) y ofrece un acceso
 * rápido a la página completa. Incorpora un carrusel auto-avanzable (cada 4s)
 * de 4 diapositivas con estadísticas calculadas en tiempo real.
 */
export function DirectorioWidget(): ReactNode {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDirectory();
      if (mountedRef.current) {
        setEntries(data);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudo cargar el directorio.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading || error || isPaused || entries.length === 0) return;
    const interval = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % 4);
    }, 4000);
    return () => clearInterval(interval);
  }, [loading, error, isPaused, entries.length]);

  // Cálculos en tiempo real
  const totalCount = entries.length;
  const collaboratorsCount = entries.filter((e) => !e.isClientUser).length;
  const clientsCount = entries.filter((e) => e.isClientUser).length;

  const uniqueCompanies = Array.from(
    new Set(entries.filter((e) => e.isClientUser && e.companyName).map((e) => e.companyName)),
  ).filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  const uniqueCompaniesCount = uniqueCompanies.length;

  const roleCounts: Record<string, number> = {};
  entries.forEach((e) => {
    e.roleKeys.forEach((r) => {
      roleCounts[r] = (roleCounts[r] || 0) + 1;
    });
  });
  const sortedRoles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <WidgetShell
      title="Directorio"
      description="Personas que puedes ver"
      icon={Contact}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div
        className="flex flex-col gap-4 h-44 justify-between select-none"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Contenedor de Diapositivas */}
        <div className="relative flex-1 overflow-hidden">
          {/* Diapositiva 0: Composición */}
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-center transition-all duration-500 ease-in-out',
              activeSlide === 0 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
            )}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Composición de la red
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight tabular-nums">{totalCount}</span>
              <span className="text-xs text-muted-foreground">Personas registradas</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-accent/40 p-2">
                <span className="block font-bold text-foreground">{collaboratorsCount}</span>
                <span className="text-muted-foreground">Colaboradores</span>
              </div>
              <div className="rounded-lg bg-accent/40 p-2">
                <span className="block font-bold text-foreground">{clientsCount}</span>
                <span className="text-muted-foreground">Clientes ITO</span>
              </div>
            </div>
          </div>

          {/* Diapositiva 1: Empresas */}
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-center transition-all duration-500 ease-in-out',
              activeSlide === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
            )}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Empresas en la red
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight tabular-nums">{uniqueCompaniesCount}</span>
              <span className="text-xs text-muted-foreground">
                {uniqueCompaniesCount === 1 ? 'Empresa cliente' : 'Empresas clientes'}
              </span>
            </div>
            <div className="mt-2 rounded-lg bg-accent/40 p-2 text-xs">
              <span className="block font-semibold text-muted-foreground mb-0.5">Compañías registradas:</span>
              <span className="block truncate text-foreground font-medium">
                {uniqueCompaniesCount > 0 ? uniqueCompanies.slice(0, 3).join(', ') + (uniqueCompanies.length > 3 ? '...' : '') : 'Ninguna registrada'}
              </span>
            </div>
          </div>

          {/* Diapositiva 2: Roles */}
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-center transition-all duration-500 ease-in-out',
              activeSlide === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
            )}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Roles Principales
            </p>
            <div className="mt-1 space-y-1.5">
              {sortedRoles.length > 0 ? (
                sortedRoles.map(([roleKey, count]) => (
                  <div key={roleKey} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      {ROLE_LABELS[roleKey as RoleKey] || roleKey}
                    </span>
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {count} {count === 1 ? 'persona' : 'personas'}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No hay roles asignados.</p>
              )}
            </div>
          </div>

          {/* Diapositiva 3: Acceso Directo */}
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-center transition-all duration-500 ease-in-out',
              activeSlide === 3 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none',
            )}
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Acceso Rápido
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Busca perfiles, verifica certificados y accede al contacto de tu equipo o ITOs asignadas.
            </p>
            <div className="mt-2 text-[10px] text-primary font-semibold flex items-center gap-2">
              <span>● Búsqueda instantánea</span>
              <span>• Filtros por empresa</span>
            </div>
          </div>
        </div>

        {/* Indicadores y botón de enlace */}
        <div className="flex items-center justify-between border-t border-border/50 pt-2 shrink-0">
          {/* Indicadores */}
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((idx) => (
              <button
                key={idx}
                onClick={() => setActiveSlide(idx)}
                className={cn(
                  'size-2 rounded-full transition-all duration-300',
                  activeSlide === idx ? 'bg-primary w-4' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50',
                )}
                aria-label={`Ir a diapositiva ${idx + 1}`}
              />
            ))}
          </div>

          <Link
            to="/directorio"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'h-8 px-2 text-xs font-semibold text-primary hover:text-primary/80 hover:bg-primary/5' })}
          >
            Ver directorio →
          </Link>
        </div>
      </div>
    </WidgetShell>
  );
}
