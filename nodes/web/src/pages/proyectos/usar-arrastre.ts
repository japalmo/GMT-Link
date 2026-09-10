import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Arrastre de los paneles del tablero sobre el mapa. Cada bloque guarda su
 * desplazamiento respecto de donde lo dejó el layout, no una posición absoluta:
 * así el tablero sigue siendo responsive y el panel movido acompaña al layout
 * cuando cambia el tamaño de la pantalla.
 *
 * La disposición se guarda por navegador. La TV de faena queda ordenada como la
 * dejaron y sobrevive a un reinicio; no se comparte con el resto, que es lo que
 * se decidió.
 */

export interface Desplazamiento {
  x: number;
  y: number;
}

const CERO: Desplazamiento = { x: 0, y: 0 };

function clave(ambito: string): string {
  return `gmt.tablero.${ambito}`;
}

function leer(ambito: string): Record<string, Desplazamiento> {
  try {
    const crudo = window.localStorage.getItem(clave(ambito));
    if (!crudo) return {};
    const dato: unknown = JSON.parse(crudo);
    return typeof dato === 'object' && dato !== null ? (dato as Record<string, Desplazamiento>) : {};
  } catch {
    // Modo privado, almacenamiento lleno o dato corrupto: se arranca ordenado.
    return {};
  }
}

function guardar(ambito: string, valor: Record<string, Desplazamiento>): void {
  try {
    window.localStorage.setItem(clave(ambito), JSON.stringify(valor));
  } catch {
    // Que no se pueda recordar la disposición no puede voltear el tablero.
  }
}

/**
 * Estado de la disposición completa. `ambito` separa un proyecto de otro para
 * que mover los paneles de una obra no descoloque los de la siguiente.
 */
export function useDisposicion(ambito: string) {
  const [posiciones, setPosiciones] = useState<Record<string, Desplazamiento>>(() => leer(ambito));

  useEffect(() => {
    setPosiciones(leer(ambito));
  }, [ambito]);

  const mover = useCallback(
    (id: string, d: Desplazamiento) => {
      setPosiciones((prev) => {
        const siguiente = { ...prev, [id]: d };
        guardar(ambito, siguiente);
        return siguiente;
      });
    },
    [ambito],
  );

  const reiniciar = useCallback(() => {
    setPosiciones({});
    guardar(ambito, {});
  }, [ambito]);

  const movido = Object.values(posiciones).some((d) => d.x !== 0 || d.y !== 0);

  return { posiciones, mover, reiniciar, movido };
}

/**
 * Convierte un elemento en arrastrable desde su asa. Usa eventos de puntero, no
 * drag-and-drop de HTML: el nativo arrastra una imagen fantasma y no sirve para
 * mover un panel con precisión, menos en una pantalla táctil de faena.
 */
export function useArrastrable(
  id: string,
  posicion: Desplazamiento | undefined,
  onMover: (id: string, d: Desplazamiento) => void,
  activo: boolean,
) {
  const actual = posicion ?? CERO;
  const [arrastrando, setArrastrando] = useState(false);
  const inicio = useRef<{ x: number; y: number; base: Desplazamiento } | null>(null);
  const vivo = useRef(actual);
  vivo.current = actual;

  const alTomar = useCallback(
    (e: React.PointerEvent) => {
      if (!activo || e.button !== 0) return;
      // El asa contiene botones (fijar, puntos): si se apretó uno, no se arrastra.
      if ((e.target as HTMLElement).closest('button, select, a, input')) return;
      e.preventDefault();
      inicio.current = { x: e.clientX, y: e.clientY, base: vivo.current };
      setArrastrando(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [activo],
  );

  const alMover = useCallback(
    (e: React.PointerEvent) => {
      const ini = inicio.current;
      if (!ini) return;
      onMover(id, { x: ini.base.x + (e.clientX - ini.x), y: ini.base.y + (e.clientY - ini.y) });
    },
    [id, onMover],
  );

  const alSoltar = useCallback((e: React.PointerEvent) => {
    if (!inicio.current) return;
    inicio.current = null;
    setArrastrando(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return {
    arrastrando,
    /** Se aplica al CONTENEDOR del panel. */
    estilo: activo
      ? {
          transform: `translate3d(${actual.x}px, ${actual.y}px, 0)`,
          // Sin transición mientras se arrastra: si no, el panel persigue al
          // puntero con retraso y se siente pegajoso.
          transition: arrastrando ? 'none' : 'transform 180ms ease-out',
          zIndex: arrastrando ? 40 : undefined,
        }
      : undefined,
    /** Se aplican al ASA (el encabezado del panel). */
    asa: activo
      ? {
          onPointerDown: alTomar,
          onPointerMove: alMover,
          onPointerUp: alSoltar,
          onPointerCancel: alSoltar,
          style: { cursor: arrastrando ? 'grabbing' : 'grab', touchAction: 'none' as const },
        }
      : {},
  };
}
