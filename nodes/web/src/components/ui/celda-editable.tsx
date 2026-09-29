import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Loader2, TriangleAlert } from 'lucide-react';

/**
 * Celda numérica de una tabla tipo planilla.
 *
 * Existe porque cargar un corte semanal son decenas de celdas seguidas, y con
 * un formulario normal —clic, escribir, clic en Guardar— eso es media hora de
 * suplicio. Acá se escribe y se pasa a la siguiente con el teclado, como en
 * Excel, que es la herramienta que esto viene a reemplazar.
 *
 * ── Qué resuelve ───────────────────────────────────────────────────────────
 *
 * - **Teclado**: Enter baja, Tab avanza a la derecha (el del navegador) y las
 *   flechas se mueven en las cuatro direcciones. Escape descarta lo escrito y
 *   deja el valor anterior.
 * - **Autoguardado al salir del campo**, con indicador. Un botón "Guardar" al
 *   final de una tabla de esta densidad es una invitación a perder el trabajo
 *   por cerrar la pestaña.
 * - **Pegado desde Excel**: pegar una columna llena las celdas hacia abajo.
 *   Es como la gente va a traer los datos el primer día.
 * - **Rango**: fuera de 0-100 se marca y NO se guarda. Un informe firmado no
 *   puede recibir un 1.200% por un cero de más.
 *
 * ── Cómo navega ────────────────────────────────────────────────────────────
 *
 * Por atributos `data-fila` / `data-columna` en el DOM, no por refs pasadas
 * desde arriba. Con 38 actividades por 12 semanas serían 456 refs cruzando
 * media docena de componentes; el DOM ya sabe dónde está cada celda.
 */

type Estado = 'quieto' | 'guardando' | 'guardado' | 'error';

export interface CeldaEditableProps {
  /** Valor en PORCENTAJE (0-100), o `null` si no hay dato. */
  valor: number | null;
  /**
   * Guarda el valor en porcentaje. Si rechaza, la celda queda marcada en rojo
   * y NO se pierde lo escrito: la persona puede corregir y reintentar.
   */
  onGuardar: (valor: number) => Promise<void>;
  /** Coordenadas en la tabla, para moverse con el teclado. */
  fila: number;
  columna: number;
  /** Pegado de varias filas: el contenedor decide a qué celda va cada valor. */
  onPegarColumna?: (desdeFila: number, columna: number, valores: number[]) => void;
  soloLectura?: boolean;
  /** Se muestra en gris cuando no hay valor. */
  marcador?: string;
  'aria-label'?: string;
}

/** Cuánto queda visible el tilde de guardado. */
const MS_GUARDADO = 1400;

export function CeldaEditable({
  valor,
  onGuardar,
  fila,
  columna,
  onPegarColumna,
  soloLectura = false,
  marcador = '—',
  'aria-label': etiqueta,
}: CeldaEditableProps): ReactNode {
  const [texto, setTexto] = useState(() => aTexto(valor));
  const [estado, setEstado] = useState<Estado>('quieto');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  // Último número mandado al servidor. Si la persona entra y sale de la celda
  // antes de que vuelva la respuesta, `valor` todavía es el viejo y sin esto
  // se mandaría el mismo guardado dos veces (dos PATCH, dos recálculos).
  const enviado = useRef<number | null>(null);
  // Escape suelta el foco para descartar; el `blur` que eso dispara todavía ve
  // el texto escrito (el `setTexto` no llegó a pintarse) y lo guardaría.
  const descartando = useRef(false);

  // El valor puede cambiar desde afuera (recálculo tras guardar otra celda).
  // No se pisa lo que la persona está escribiendo: solo se sincroniza cuando
  // la celda no tiene el foco.
  useEffect(() => {
    enviado.current = null;
    if (document.activeElement !== ref.current) setTexto(aTexto(valor));
  }, [valor]);

  useEffect(() => {
    if (estado !== 'guardado') return;
    const t = setTimeout(() => setEstado('quieto'), MS_GUARDADO);
    return () => clearTimeout(t);
  }, [estado]);

  /**
   * Mueve el foco a la celda vecina. NO guarda: guardar es cosa del `blur`, que
   * se dispara solo al perder el foco. Si las teclas también guardaran, cada
   * Enter mandaría el valor dos veces. Sin vecina (borde de la tabla) se suelta
   * el foco igual, para que lo escrito se guarde.
   */
  function mover(dFila: number, dColumna: number): void {
    const destino = document.querySelector<HTMLInputElement>(
      `[data-fila="${fila + dFila}"][data-columna="${columna + dColumna}"]`,
    );
    if (destino) {
      destino.focus();
      destino.select();
    } else {
      ref.current?.blur();
    }
  }

  async function guardar(): Promise<void> {
    const limpio = texto.trim().replace(',', '.');
    // Vaciar la celda no es escribir cero: se deja como estaba. Borrar un dato
    // es otra acción, y confundirla con "0%" falsearía el informe.
    if (limpio === '') {
      setTexto(aTexto(valor));
      setEstado('quieto');
      setMensaje(null);
      return;
    }

    const numero = Number(limpio);
    if (!Number.isFinite(numero)) {
      setEstado('error');
      setMensaje('No es un número.');
      return;
    }
    if (numero < 0 || numero > 100) {
      setEstado('error');
      setMensaje('Debe estar entre 0 y 100.');
      return;
    }
    // Sin cambio real no se molesta al servidor ni se dispara el recálculo.
    const vigente = enviado.current ?? valor;
    if (vigente !== null && Math.abs(numero - vigente) < 0.0005) {
      setEstado('quieto');
      setMensaje(null);
      return;
    }

    setEstado('guardando');
    setMensaje(null);
    enviado.current = numero;
    try {
      await onGuardar(numero);
      setEstado('guardado');
    } catch (e: unknown) {
      enviado.current = null;
      setEstado('error');
      setMensaje(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      mover(1, 0);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setTexto(aTexto(valor));
      setEstado('quieto');
      setMensaje(null);
      descartando.current = true;
      ref.current?.blur();
      return;
    }
    // Las flechas arriba/abajo mueven de celda; izquierda/derecha solo cuando
    // el cursor ya está en el borde del texto, para no romper la edición.
    const input = e.currentTarget;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mover(1, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mover(-1, 0);
    } else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
      e.preventDefault();
      mover(0, 1);
    } else if (e.key === 'ArrowLeft' && input.selectionStart === 0) {
      e.preventDefault();
      mover(0, -1);
    }
  }

  function alPegar(e: ClipboardEvent<HTMLInputElement>): void {
    const pegado = e.clipboardData.getData('text');
    const lineas = pegado.split(/\r?\n/).filter((l) => l.trim() !== '');
    // Una sola línea es un pegado normal: lo maneja el navegador.
    if (lineas.length <= 1 || !onPegarColumna) return;

    e.preventDefault();
    const valores = lineas.map((l) => Number(l.trim().replace('%', '').replace(',', '.')));
    if (valores.some((v) => !Number.isFinite(v))) {
      setEstado('error');
      setMensaje('Lo pegado no son números.');
      return;
    }
    // La misma regla que al escribir: un pegado no puede colar un 1.200%.
    if (valores.some((v) => v < 0 || v > 100)) {
      setEstado('error');
      setMensaje('Hay valores fuera de 0 a 100; no se pegó nada.');
      return;
    }
    onPegarColumna(fila, columna, valores);
    // Esta celda tiene el foco, así que el efecto de sincronización no la toca:
    // sin esto seguiría mostrando el valor viejo y el `blur` lo guardaría
    // ENCIMA de lo recién pegado. El contenedor ya la guardó, así que queda
    // registrada como enviada.
    const propio = valores[0] ?? null;
    setTexto(aTexto(propio));
    enviado.current = propio;
    setEstado('quieto');
    setMensaje(null);
  }

  if (soloLectura) {
    return (
      <span className="block px-2 py-1 text-right text-[13px] tabular-nums text-muted-foreground">
        {valor === null ? marcador : aTexto(valor)}
      </span>
    );
  }

  return (
    <span className="relative block">
      <input
        ref={ref}
        data-fila={fila}
        data-columna={columna}
        aria-label={etiqueta}
        aria-invalid={estado === 'error'}
        inputMode="decimal"
        value={texto}
        placeholder={marcador}
        onChange={(e) => {
          setTexto(e.target.value);
          if (estado === 'error') {
            setEstado('quieto');
            setMensaje(null);
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (descartando.current) {
            descartando.current = false;
            return;
          }
          void guardar();
        }}
        onKeyDown={alTeclear}
        onPaste={alPegar}
        className={`w-full rounded-md border bg-transparent py-1 pl-2 pr-6 text-right text-[13px] tabular-nums outline-none transition focus:bg-card ${
          estado === 'error'
            ? 'border-destructive text-destructive'
            : 'border-transparent hover:border-border focus:border-primary'
        }`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
        {estado === 'guardando' && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
        )}
        {estado === 'guardado' && <Check className="size-3 text-emerald-500" aria-hidden />}
        {estado === 'error' && <TriangleAlert className="size-3 text-destructive" aria-hidden />}
      </span>
      {mensaje && (
        // `role="alert"` para que el lector de pantalla lo anuncie: la marca
        // roja sola no le sirve a quien no ve la celda.
        <span
          role="alert"
          className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[11px] text-destructive-foreground"
        >
          {mensaje}
        </span>
      )}
    </span>
  );
}

/** Número a texto para el campo. Un decimal, que es como se informa. */
function aTexto(valor: number | null): string {
  if (valor === null) return '';
  return String(Math.round(valor * 10) / 10);
}
