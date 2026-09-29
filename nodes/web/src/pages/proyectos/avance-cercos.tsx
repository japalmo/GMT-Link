import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2, Satellite, Trash2 } from 'lucide-react';
import type { ObraMapPoint } from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getObraDashboard, quitarFotoCerco, subirFotoCerco } from '@/lib/api';
import { prepararFoto } from '@/lib/preparar-foto';
import { fechaCorta, formatoPct } from './avance-comun';

/**
 * Una fila por cerco, con su foto de terreno.
 *
 * Los cercos salen del mismo mapa que dibuja el tablero, así que la lista y el
 * mapa no pueden discrepar sobre qué es un cerco. La foto más nueva reemplaza
 * la vista satelital; quitarla la devuelve.
 */
export function AvanceCercos({
  projectId,
  puedeEditar,
}: {
  projectId: string;
  puedeEditar: boolean;
}): ReactNode {
  const [cercos, setCercos] = useState<ObraMapPoint[] | null>(null);
  const [sinUbicar, setSinUbicar] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await getObraDashboard(projectId);
      setCercos([...d.map.points].sort(porCodigo));
      setSinUbicar(d.map.unlocated);
      setError(null);
    } catch (e) {
      setError(errorToMessage(e, 'No se pudieron cargar los cercos.'));
    }
  }, [projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!cercos) return <LoadingState rows={4} label="Cargando los cercos…" />;
  if (cercos.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta obra no tiene cercos ubicados en el mapa.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Cerco</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium">Avance</th>
              <th className="px-2 py-2 font-medium">Imagen en el tablero</th>
              {puedeEditar && <th className="px-2 py-2 text-right font-medium">Foto</th>}
            </tr>
          </thead>
          <tbody>
            {cercos.map((c) => (
              <FilaCerco
                key={c.id}
                projectId={projectId}
                cerco={c}
                puedeEditar={puedeEditar}
                onCambio={cargar}
              />
            ))}
          </tbody>
        </table>
      </div>
      {sinUbicar > 0 && (
        <p className="text-xs text-muted-foreground">
          {sinUbicar} {sinUbicar === 1 ? 'cerco no aparece' : 'cercos no aparecen'} porque no
          {sinUbicar === 1 ? ' tiene' : ' tienen'} coordenadas: sin ubicación el tablero no puede
          mostrar su imagen.
        </p>
      )}
    </div>
  );
}

function FilaCerco({
  projectId,
  cerco,
  puedeEditar,
  onCambio,
}: {
  projectId: string;
  cerco: ObraMapPoint;
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<'subiendo' | 'quitando' | null>(null);
  const foto = cerco.photos[0] ?? null;

  async function subir(archivo: File): Promise<void> {
    setOcupado('subiendo');
    try {
      // Achicada en el navegador: una foto de celular pesa varios MB y en
      // faena la señal es mala.
      const lista = await prepararFoto(archivo).catch(() => archivo);
      await subirFotoCerco(projectId, cerco.id, lista);
      toast.success(`Foto de ${cerco.code} cargada. El tablero ya la muestra.`);
      await onCambio();
    } catch (e) {
      toast.error(errorToMessage(e, 'No se pudo subir la foto.'));
    } finally {
      setOcupado(null);
      if (input.current) input.current.value = '';
    }
  }

  async function quitar(): Promise<void> {
    setOcupado('quitando');
    try {
      const { quedan } = await quitarFotoCerco(projectId, cerco.id);
      toast.success(
        quedan > 0
          ? `Foto quitada. Queda la anterior (${quedan}).`
          : `Foto quitada. ${cerco.code} vuelve a la vista satelital.`,
      );
      await onCambio();
    } catch (e) {
      toast.error(errorToMessage(e, 'No se pudo quitar la foto.'));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2 font-medium">{cerco.code}</td>
      <td className="px-2 py-2 text-muted-foreground">{cerco.sector ?? '—'}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatoPct(cerco.percent)}</td>
      <td className="px-2 py-2">
        {foto ? (
          <a
            href={foto.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 hover:underline"
          >
            <img
              src={foto.url}
              alt={`Foto de terreno de ${cerco.code}`}
              className="size-10 rounded object-cover"
              loading="lazy"
            />
            <span className="text-xs text-muted-foreground">Foto · {fechaCorta(foto.date)}</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Satellite className="size-3.5" aria-hidden />
            Vista satelital
          </span>
        )}
      </td>
      {puedeEditar && (
        <td className="px-2 py-2">
          <div className="flex justify-end gap-1">
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label={`Foto de terreno de ${cerco.code}`}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) void subir(archivo);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={ocupado !== null}
              onClick={() => input.current?.click()}
            >
              {ocupado === 'subiendo' ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Camera className="mr-1.5 size-3.5" />
              )}
              {foto ? 'Reemplazar' : 'Subir'}
            </Button>
            {foto && (
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado !== null}
                onClick={() => void quitar()}
                aria-label={`Quitar la foto de ${cerco.code}`}
              >
                {ocupado === 'quitando' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5 text-destructive" />
                )}
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * Orden de cerco: por tipo y luego por NÚMERO romano. Ordenado como texto
 * quedaba A-IV, A-IX, A-V, que no es como se recorre la obra.
 */
function porCodigo(x: ObraMapPoint, y: ObraMapPoint): number {
  const [tx = '', rx = ''] = x.code.split('-');
  const [ty = '', ry = ''] = y.code.split('-');
  return tx.localeCompare(ty, 'es') || romano(rx) - romano(ry) || x.code.localeCompare(y.code, 'es');
}

function romano(texto: string): number {
  const valor: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const actual = valor[texto[i] ?? ''] ?? 0;
    const siguiente = valor[texto[i + 1] ?? ''] ?? 0;
    total += actual < siguiente ? -actual : actual;
  }
  return total;
}
