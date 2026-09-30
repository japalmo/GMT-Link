import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import type { AvanceObraEditable } from '@gmt-platform/contracts';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getAvanceObra } from '@/lib/api';
import { AvanceActividades } from './avance-actividades';
import { AvanceCercos } from './avance-cercos';
import { AvanceSemanas } from './avance-semanas';

/**
 * Pestaña "Avance": el control de obra editable, en tablas tipo planilla.
 *
 * Reemplaza el flujo de asignar tareas para reportar: quien lleva el control
 * (Felipe Díaz en el Cierre Perimetral) carga el corte semanal acá, igual que lo
 * hacía en su Excel, y el tablero se actualiza solo.
 */
export function AvanceTab({ projectId }: { projectId: string }): ReactNode {
  const [datos, setDatos] = useState<AvanceObraEditable | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cada guardado pide los datos de nuevo (el recálculo mueve las semanas). Con
  // varias celdas guardándose seguidas las respuestas pueden llegar en otro
  // orden: solo se aplica la de la ÚLTIMA petición, para no pintar datos viejos.
  const turno = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    try {
      const d = await getAvanceObra(projectId);
      if (mio !== turno.current) return;
      setDatos(d);
      setError(null);
    } catch (e) {
      if (mio !== turno.current) return;
      setError(errorToMessage(e, 'No se pudo cargar el control de avance.'));
    }
  }, [projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !datos) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!datos) return <LoadingState rows={8} label="Cargando el control de avance…" />;

  return (
    <div className="flex flex-col gap-8">
      {!datos.puedeEditar && (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" aria-hidden />
          Solo lectura. Para cargar el avance se necesita el permiso “Gestionar avance de obra” en
          este proyecto.
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="avance-semanas">
        <header>
          <h2 id="avance-semanas" className="text-base font-semibold">
            Informe semanal
          </h2>
          <p className="text-sm text-muted-foreground">
            Las columnas del informe. El real sale de las actividades; si lo sobreescribes, la celda
            queda marcada con el calculado al lado.
          </p>
        </header>
        <AvanceSemanas projectId={projectId} datos={datos} onCambio={cargar} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="avance-actividades">
        <header>
          <h2 id="avance-actividades" className="text-base font-semibold">
            Avance por actividad
          </h2>
          <p className="text-sm text-muted-foreground">
            % acumulado de cada actividad al cierre de cada semana. Enter y las flechas mueven entre
            celdas; se guarda al salir. Puedes pegar una columna desde Excel. En gris, el valor que
            se arrastra de la semana anterior.
          </p>
        </header>
        <AvanceActividades projectId={projectId} datos={datos} onCambio={cargar} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="avance-cercos">
        <header>
          <h2 id="avance-cercos" className="text-base font-semibold">
            Fotos de los cercos
          </h2>
          <p className="text-sm text-muted-foreground">
            Sin foto, el tablero muestra la vista satelital. Al subir una foto del sitio, el tablero
            muestra esa foto.
          </p>
        </header>
        <AvanceCercos projectId={projectId} puedeEditar={datos.puedeEditar} />
      </section>
    </div>
  );
}
