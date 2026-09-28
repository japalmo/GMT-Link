import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Eraser, Undo2 } from 'lucide-react';

/**
 * Firma a mano alzada, para firmar con el dedo en el teléfono.
 *
 * ── Por qué guarda los trazos y no solo píxeles ────────────────────────────
 *
 * El canvas se redimensiona: cambia el ancho del teléfono al girarlo, y el alto
 * depende del contenedor. Si el estado fuera el mapa de píxeles, cada
 * redimensión borraría la firma o la estiraría. Guardando los puntos se vuelve
 * a dibujar nítido a cualquier tamaño, y además se puede deshacer trazo a trazo.
 *
 * ── Detalles que hacen que se sienta bien con el dedo ──────────────────────
 *
 * - Eventos de puntero (no de ratón ni de tacto por separado): cubren dedo,
 *   lápiz y ratón con el mismo código, y `setPointerCapture` evita que el trazo
 *   se corte si el dedo sale del recuadro.
 * - `touch-action: none`: sin esto el navegador interpreta el arrastre como
 *   desplazamiento de la página y no se puede firmar.
 * - Se dibuja con curvas entre los puntos medios de cada par de puntos. Unir
 *   los puntos con rectas deja una firma con esquinas, que se ve temblorosa.
 * - El lienzo se escala por `devicePixelRatio`: sin eso la línea se ve borrosa
 *   en pantallas de alta densidad, que son todos los teléfonos.
 *
 * ── Lo que entrega ─────────────────────────────────────────────────────────
 *
 * Un PNG con fondo TRANSPARENTE, recortado al contenido y con un margen. Va
 * transparente porque en el PDF se dibuja sobre la línea de firma del formato;
 * un fondo blanco taparía esa línea.
 */

/** Un trazo: la secuencia de puntos entre que se apoya y se levanta el dedo. */
type Trazo = Array<{ x: number; y: number }>;

/** Grosor de la línea, en píxeles de CSS. */
const GROSOR = 2.4;

/** Margen que se deja alrededor de la firma al recortarla. */
const MARGEN = 8;

export function FirmaCanvas({
  valor,
  onChange,
  alto = 180,
  etiqueta = 'Firma',
}: {
  /** PNG en data URL, o `null` si todavía no hay firma. */
  valor: string | null;
  onChange: (dataUrl: string | null) => void;
  alto?: number;
  etiqueta?: string;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trazosRef = useRef<Trazo[]>([]);
  const trazoActual = useRef<Trazo | null>(null);
  const [vacio, setVacio] = useState(true);

  /** Redibuja todos los trazos sobre el lienzo, ajustando el tamaño real. */
  const redibujar = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const ancho = canvas.clientWidth;
    const altoCss = canvas.clientHeight;
    // Solo se reasigna si cambió: tocar width/height limpia el lienzo.
    if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(altoCss * dpr)) {
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(altoCss * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ancho, altoCss);

    ctx.lineWidth = GROSOR;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // `currentColor` no existe en canvas: se lee el color calculado del
    // elemento para que la tinta siga al tema claro/oscuro.
    ctx.strokeStyle = getComputedStyle(canvas).color;

    for (const trazo of trazosRef.current) {
      dibujarTrazo(ctx, trazo);
    }
  }, []);

  // El lienzo se adapta al ancho del contenedor: al girar el teléfono hay que
  // volver a dibujar, o la firma queda estirada.
  //
  // Se escucha por DOS vías a propósito. `ResizeObserver` cubre los cambios del
  // contenedor que no mueven la ventana, pero sus avisos se entregan junto con
  // el dibujado de la página y hay entornos donde no llegan. `resize` y
  // `orientationchange` son eventos normales y cubren el caso que de verdad
  // importa acá: girar el teléfono con la firma ya hecha. Redibujar de más no
  // cuesta nada; no redibujar deja la firma estirada.
  useEffect(() => {
    redibujar();
    const canvas = canvasRef.current;
    const observador =
      canvas && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => redibujar())
        : null;
    observador?.observe(canvas as Element);
    window.addEventListener('resize', redibujar);
    window.addEventListener('orientationchange', redibujar);
    return () => {
      observador?.disconnect();
      window.removeEventListener('resize', redibujar);
      window.removeEventListener('orientationchange', redibujar);
    };
  }, [redibujar]);

  // Si el contenedor limpia el valor desde afuera (p. ej. "llenar otro"), se
  // descartan los trazos para que el lienzo no quede con una firma huérfana.
  useEffect(() => {
    if (valor === null && trazosRef.current.length > 0) {
      trazosRef.current = [];
      setVacio(true);
      redibujar();
    }
  }, [valor, redibujar]);

  function puntoDe(e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function empezar(e: PointerEvent<HTMLCanvasElement>): void {
    // Última red: si el lienzo quedó con un tamaño viejo porque ningún aviso de
    // redimensión llegó, se corrige antes de empezar el trazo. Los puntos se
    // miden con `getBoundingClientRect`, así que caen bien igual; esto evita
    // que se vea estirado mientras se firma.
    redibujar();
    // Capturar el puntero mantiene el trazo aunque el dedo salga del recuadro.
    // Puede fallar (el puntero ya no existe, o el navegador se niega) y eso NO
    // puede impedir firmar: sin el try/catch, la excepción corta la función y
    // el trazo nunca empieza.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Se sigue sin captura: el trazo se corta si el dedo sale, nada más.
    }
    trazoActual.current = [puntoDe(e)];
    trazosRef.current.push(trazoActual.current);
    setVacio(false);
  }

  function mover(e: PointerEvent<HTMLCanvasElement>): void {
    const trazo = trazoActual.current;
    if (!trazo) return;
    // `getCoalescedEvents` devuelve los puntos intermedios que el navegador
    // agrupó en un solo evento. Sin esto, un trazo rápido con el dedo sale
    // poligonal porque solo llegan unos pocos puntos por segundo.
    //
    // Puede devolver una lista VACÍA (es lo que hace con eventos sintéticos, y
    // no está garantizado que siempre traiga algo). Si se confía en ella sin
    // mirar, el trazo se queda en el punto inicial y la firma sale como un
    // punto: hay que caer al evento mismo.
    const agrupados =
      typeof e.nativeEvent.getCoalescedEvents === 'function'
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    const eventos = agrupados.length > 0 ? agrupados : [e.nativeEvent];
    const r = e.currentTarget.getBoundingClientRect();
    for (const ev of eventos) {
      trazo.push({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    }
    redibujar();
  }

  function terminar(): void {
    if (!trazoActual.current) return;
    trazoActual.current = null;
    emitir();
  }

  /** Exporta el PNG recortado y avisa al contenedor. */
  function emitir(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(exportarRecortado(canvas, trazosRef.current));
  }

  function limpiar(): void {
    trazosRef.current = [];
    trazoActual.current = null;
    setVacio(true);
    redibujar();
    onChange(null);
  }

  function deshacer(): void {
    trazosRef.current.pop();
    const quedan = trazosRef.current.length > 0;
    setVacio(!quedan);
    redibujar();
    onChange(quedan ? exportarRecortado(canvasRef.current, trazosRef.current) : null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <canvas
          ref={canvasRef}
          style={{ height: alto, touchAction: 'none' }}
          className="block w-full text-foreground"
          role="img"
          aria-label={vacio ? `${etiqueta}: recuadro vacío para firmar` : `${etiqueta} trazada`}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
        />
        {vacio && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            {/* Línea de firma, como en el papel: indica dónde va sin estorbar. */}
            <span className="h-px w-2/3 bg-border" aria-hidden />
            <span className="text-[13px] text-muted-foreground">Firma con el dedo</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={deshacer}
          disabled={vacio}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[14px] font-medium transition active:scale-[0.98] disabled:opacity-40"
        >
          <Undo2 className="size-4" aria-hidden />
          Deshacer
        </button>
        <button
          type="button"
          onClick={limpiar}
          disabled={vacio}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[14px] font-medium transition active:scale-[0.98] disabled:opacity-40"
        >
          <Eraser className="size-4" aria-hidden />
          Borrar
        </button>
      </div>
    </div>
  );
}

/**
 * Dibuja un trazo con curvas entre los puntos medios.
 *
 * Unir los puntos con rectas deja esquinas visibles; pasando una curva
 * cuadrática por cada punto medio la línea sale continua, que es como se ve una
 * firma de verdad. Un trazo de un solo punto (un toque) se dibuja como punto.
 */
function dibujarTrazo(ctx: CanvasRenderingContext2D, trazo: Trazo): void {
  const p0 = trazo[0];
  if (!p0) return;

  if (trazo.length === 1) {
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, GROSOR / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < trazo.length - 1; i += 1) {
    const actual = trazo[i];
    const siguiente = trazo[i + 1];
    if (!actual || !siguiente) break;
    ctx.quadraticCurveTo(
      actual.x,
      actual.y,
      (actual.x + siguiente.x) / 2,
      (actual.y + siguiente.y) / 2,
    );
  }
  const ultimo = trazo[trazo.length - 1];
  if (ultimo) ctx.lineTo(ultimo.x, ultimo.y);
  ctx.stroke();
}

/**
 * PNG transparente recortado al contenido de la firma.
 *
 * Se recorta porque el recuadro donde se firma es mucho más grande que la
 * firma: sin recortar, en el PDF la firma saldría diminuta en medio de un
 * rectángulo vacío. El recorte se calcula de los PUNTOS, no leyendo píxeles,
 * que es más rápido y no depende del contenido del lienzo.
 */
function exportarRecortado(canvas: HTMLCanvasElement | null, trazos: Trazo[]): string | null {
  if (!canvas || trazos.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const trazo of trazos) {
    for (const p of trazo) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;

  const borde = MARGEN + GROSOR;
  const ancho = Math.max(1, Math.ceil(maxX - minX + borde * 2));
  const alto = Math.max(1, Math.ceil(maxY - minY + borde * 2));

  // Se exporta al doble de resolución: la firma se imprime en el PDF y una
  // línea de un píxel se ve dentada al ampliarla.
  const escala = 2;
  const salida = document.createElement('canvas');
  salida.width = ancho * escala;
  salida.height = alto * escala;
  const ctx = salida.getContext('2d');
  if (!ctx) return null;

  ctx.scale(escala, escala);
  ctx.translate(borde - minX, borde - minY);
  ctx.lineWidth = GROSOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Tinta fija y oscura: el PNG va a un PDF impreso, donde el color del tema
  // de quien firmó no tiene ningún sentido (y en modo oscuro sería casi blanca).
  ctx.strokeStyle = '#111827';

  for (const trazo of trazos) {
    dibujarTrazo(ctx, trazo);
  }
  return salida.toDataURL('image/png');
}
