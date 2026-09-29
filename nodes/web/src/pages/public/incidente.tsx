import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { BrandLogo } from '@/components/branding/brand-logo';
import {
  Aviso,
  BarraPasos,
  Campo,
  ENTRADA,
  Pantalla,
  Segmentado,
} from '@/components/form-wizard';
import { MapaArea, SelectorFecha, SelectorHora } from './incidente-campos';
import { createHseIncident, errorToMessage, fetchHseIncidentPdf } from '@/lib/api';
import { prepararFoto } from '@/lib/preparar-foto';

/**
 * Reporte de incidente, formulario público de terreno.
 *
 * Se llena desde el celular, muchas veces a un costado de la ruta y con una mano
 * ocupada, así que va por pasos cortos: cada pantalla pregunta una sola cosa y
 * el botón de avanzar está siempre al alcance del pulgar. Nada se pierde al
 * cambiar de paso porque todo vive en el mismo estado.
 *
 * Las fotos se convierten a JPEG y se achican en el navegador antes de subir:
 * una foto de celular pesa varios MB y en faena la señal es mala.
 */

const PASOS = ['Dónde y cuándo', 'Qué ocurrió', 'Relato', 'Fotos', 'Quién reporta'] as const;

/** Las casillas de "Consecuencias" del formato, con su detalle. */
const CONSECUENCIAS = [
  { key: 'lesionPersonas', label: 'Lesión a personas', detalle: 'cargoLesionado', pista: 'Cargo del lesionado' },
  { key: 'danoInfraestructura', label: 'Daño a infraestructura o equipo', detalle: 'danoDetalle', pista: 'Qué se dañó' },
  { key: 'fugaDerrame', label: 'Fuga o derrame', detalle: 'fugaSustancia', pista: 'Sustancia' },
  { key: 'emisionesAire', label: 'Emisiones al aire', detalle: 'emisionGases', pista: 'Gases' },
  { key: 'instalaciones', label: 'Instalaciones (robos, hurtos)', detalle: 'instalacionesLugar', pista: 'Lugar específico' },
  { key: 'cuasiAccidente', label: 'Cuasi accidente', detalle: null, pista: null },
  { key: 'procesoAfectado', label: 'Proceso o área afectado', detalle: null, pista: null },
] as const;

type ClaveConsecuencia = (typeof CONSECUENCIAS)[number]['key'];

/** Los turnos que se trabajan en GMT. El último deja el campo vacío en el reporte. */
const TURNOS = [
  { valor: '7x7', label: '7x7' },
  { valor: '5x2', label: '5x2' },
  { valor: '4x3', label: '4x3' },
  { valor: '8x6', label: '8x6' },
  { valor: '14x14', label: '14x14' },
  { valor: '', label: 'Sin turno' },
] as const;

interface Formulario {
  sitio: string;
  area: string;
  /** Dónde quedó el pin del mapa. `null` mientras no se mueva. */
  coords: { lat: number; lng: number } | null;
  fecha: string;
  hora: string;
  turno: string;
  marcadas: Record<ClaveConsecuencia, boolean>;
  cargoLesionado: string;
  danoDetalle: string;
  fugaSustancia: string;
  emisionGases: string;
  instalacionesLugar: string;
  tiempoPerdido: 'CON' | 'SIN' | '';
  descripcion: string;
  acciones: string[];
  preparaNombre: string;
  preparaCargo: string;
  reporterEmail: string;
}

/** Máximo de fotos: la primera va en el recuadro del formato. */
const MAX_FOTOS = 3;

function hoyLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function ahoraLocal(): string {
  const d = new Date();
  // Al múltiplo de 5 más cercano hacia abajo, que es el paso de la rueda de
  // minutos: así la hora prellenada siempre coincide con una fila.
  const minuto = Math.floor(d.getMinutes() / 5) * 5;
  return `${String(d.getHours()).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

const VACIO: Formulario = {
  sitio: '',
  area: '',
  coords: null,
  fecha: hoyLocal(),
  hora: ahoraLocal(),
  turno: '',
  marcadas: {
    lesionPersonas: false,
    danoInfraestructura: false,
    fugaDerrame: false,
    emisionesAire: false,
    instalaciones: false,
    cuasiAccidente: false,
    procesoAfectado: false,
  },
  cargoLesionado: '',
  danoDetalle: '',
  fugaSustancia: '',
  emisionGases: '',
  instalacionesLugar: '',
  tiempoPerdido: '',
  descripcion: '',
  acciones: [''],
  preparaNombre: '',
  preparaCargo: '',
  reporterEmail: '',
};

/** Una foto ya lista para subir, con su vista previa. */
interface FotoLista {
  archivo: File;
  preview: string;
}

export default function PublicIncidentePage(): ReactNode {
  const [paso, setPaso] = useState(0);
  const [form, setForm] = useState<Formulario>(VACIO);
  const [fotos, setFotos] = useState<FotoLista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<{ code: string; publicToken: string } | null>(null);
  const [descargando, setDescargando] = useState(false);
  const inicioRef = useRef<HTMLDivElement>(null);

  const set = useCallback(<K extends keyof Formulario>(campo: K, valor: Formulario[K]) => {
    setForm((p) => ({ ...p, [campo]: valor }));
    setError(null);
  }, []);

  // Cada paso empieza arriba: en el celular, avanzar y quedar a media pantalla
  // hace perder el título de la pregunta.
  useEffect(() => {
    inicioRef.current?.scrollIntoView({ block: 'start' });
  }, [paso, enviado]);

  useEffect(
    () => () => {
      fotos.forEach((f) => URL.revokeObjectURL(f.preview));
    },
    [fotos],
  );

  const problema = useMemo((): string | null => {
    if (paso === 0) {
      if (!form.fecha) return 'Indica la fecha del incidente.';
      if (!form.hora) return 'Indica la hora del incidente.';
      if (form.fecha > hoyLocal()) return 'La fecha no puede ser futura.';
      return null;
    }
    if (paso === 1) {
      return Object.values(form.marcadas).some(Boolean)
        ? null
        : 'Marca al menos una consecuencia.';
    }
    if (paso === 2) {
      if (form.descripcion.trim().length < 20) {
        return 'Cuenta lo ocurrido con un poco más de detalle.';
      }
      return form.acciones.some((a) => a.trim()) ? null : 'Escribe al menos una acción tomada.';
    }
    if (paso === 3) return fotos.length > 0 ? null : 'Adjunta al menos una foto.';
    return form.preparaNombre.trim().length >= 3 ? null : 'Escribe tu nombre.';
  }, [paso, form, fotos]);

  function avanzar(): void {
    if (problema) {
      setError(problema);
      return;
    }
    if (paso < PASOS.length - 1) setPaso(paso + 1);
    else void enviar();
  }

  async function agregarFotos(lista: FileList | null): Promise<void> {
    if (!lista || lista.length === 0) return;
    const espacio = MAX_FOTOS - fotos.length;
    if (espacio <= 0) {
      setError(`Puedes adjuntar hasta ${MAX_FOTOS} fotos.`);
      return;
    }
    const nuevas: FotoLista[] = [];
    for (const archivo of Array.from(lista).slice(0, espacio)) {
      try {
        const listo = await prepararFoto(archivo);
        nuevas.push({ archivo: listo, preview: URL.createObjectURL(listo) });
      } catch {
        setError('No pudimos leer esa imagen. Intenta con una foto JPG o PNG.');
      }
    }
    if (nuevas.length > 0) {
      setFotos((p) => [...p, ...nuevas]);
      setError(null);
    }
  }

  async function enviar(): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      const datos = new FormData();
      datos.append('fecha', form.fecha);
      datos.append('hora', form.hora);
      if (form.sitio.trim()) datos.append('sitio', form.sitio.trim());
      if (form.area.trim()) datos.append('area', form.area.trim());
      if (form.coords) {
        datos.append('latitude', String(form.coords.lat));
        datos.append('longitude', String(form.coords.lng));
      }
      if (form.turno) datos.append('turno', form.turno);
      for (const c of CONSECUENCIAS) {
        datos.append(c.key, form.marcadas[c.key] ? 'true' : 'false');
      }
      if (form.marcadas.lesionPersonas && form.cargoLesionado.trim()) {
        datos.append('cargoLesionado', form.cargoLesionado.trim());
      }
      if (form.marcadas.danoInfraestructura && form.danoDetalle.trim()) {
        datos.append('danoDetalle', form.danoDetalle.trim());
      }
      if (form.marcadas.fugaDerrame && form.fugaSustancia.trim()) {
        datos.append('fugaSustancia', form.fugaSustancia.trim());
      }
      if (form.marcadas.emisionesAire && form.emisionGases.trim()) {
        datos.append('emisionGases', form.emisionGases.trim());
      }
      if (form.marcadas.instalaciones && form.instalacionesLugar.trim()) {
        datos.append('instalacionesLugar', form.instalacionesLugar.trim());
      }
      if (form.tiempoPerdido) datos.append('tiempoPerdido', form.tiempoPerdido);
      datos.append('descripcion', form.descripcion.trim());
      datos.append(
        'accionesInmediatas',
        form.acciones
          .map((a) => a.trim())
          .filter(Boolean)
          .map((a) => (a.startsWith('.-') ? a : `.- ${a}`))
          .join('\n'),
      );
      datos.append('preparaNombre', form.preparaNombre.trim());
      if (form.preparaCargo.trim()) datos.append('preparaCargo', form.preparaCargo.trim());
      if (form.reporterEmail.trim()) datos.append('reporterEmail', form.reporterEmail.trim());
      for (const f of fotos) datos.append('fotos', f.archivo);

      const creado = await createHseIncident(datos);
      setEnviado({ code: creado.code, publicToken: creado.publicToken });
      void descargar(creado.publicToken, creado.code);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar el reporte. Revisa la señal e intenta otra vez.'));
    } finally {
      setEnviando(false);
    }
  }

  async function descargar(token: string, code: string): Promise<void> {
    setDescargando(true);
    try {
      const blob = await fetchHseIncidentPdf({ publicToken: token });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setError(errorToMessage(err, 'El reporte quedó guardado, pero no pudimos bajar el PDF.'));
    } finally {
      setDescargando(false);
    }
  }

  if (enviado) {
    return (
      <Pantalla>
        <div ref={inicioRef} />
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            <CheckCircle2 className="size-10" aria-hidden />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] font-semibold tracking-tight">Reporte enviado</h1>
            <p className="text-[15px] text-muted-foreground">
              Quedó registrado como <span className="font-semibold text-foreground">{enviado.code}</span> y
              HSE ya puede verlo.
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-3">
            <button
              type="button"
              onClick={() => void descargar(enviado.publicToken, enviado.code)}
              disabled={descargando}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-medium text-primary-foreground transition active:scale-[0.98] disabled:opacity-60"
            >
              {descargando ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-5" aria-hidden />
              )}
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({ ...VACIO, fecha: hoyLocal(), hora: ahoraLocal() });
                setFotos([]);
                setEnviado(null);
                setPaso(0);
              }}
              className="flex h-12 items-center justify-center rounded-2xl border border-border text-[16px] font-medium transition active:scale-[0.98]"
            >
              Reportar otro incidente
            </button>
          </div>
          {error && <Aviso mensaje={error} />}
        </div>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <div ref={inicioRef} />
      <header className="flex flex-col gap-4 pt-2">
        <div className="flex items-center justify-between">
          <BrandLogo className="h-16 w-auto" />
          <span className="text-[13px] font-medium text-muted-foreground">
            Paso {paso + 1} de {PASOS.length}
          </span>
        </div>
        <BarraPasos paso={paso} total={PASOS.length} />
      </header>

      <main className="flex flex-1 flex-col gap-6 pb-32 pt-7">
        <div key={paso} className="flex flex-col gap-6 duration-300 animate-in fade-in slide-in-from-right-4 motion-reduce:animate-none">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-balance">
              {['¿Dónde y cuándo ocurrió?', '¿Qué consecuencias tuvo?', '¿Qué pasó?', 'Agrega fotos', '¿Quién reporta?'][paso]}
            </h1>
            <p className="text-[15px] leading-snug text-muted-foreground">
              {[
                'Ubica el incidente para que HSE sepa dónde ir.',
                'Marca todo lo que aplique. Puedes marcar más de una.',
                'Cuenta lo que viste, sin suposiciones, y qué se hizo de inmediato.',
                'La primera foto es la que sale en el reporte.',
                'Con esto cerramos el reporte y se genera el PDF.',
              ][paso]}
            </p>
          </div>

          {paso === 0 && <PasoLugar form={form} set={set} />}
          {paso === 1 && <PasoConsecuencias form={form} set={set} />}
          {paso === 2 && <PasoRelato form={form} set={set} />}
          {paso === 3 && (
            <PasoFotos
              fotos={fotos}
              onAgregar={(lista) => void agregarFotos(lista)}
              onQuitar={(i) =>
                setFotos((p) => {
                  URL.revokeObjectURL(p[i]?.preview ?? '');
                  return p.filter((_, j) => j !== i);
                })
              }
            />
          )}
          {paso === 4 && <PasoReporta form={form} set={set} />}
        </div>
        {error && <Aviso mensaje={error} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
          {paso > 0 && (
            <button
              type="button"
              onClick={() => setPaso(paso - 1)}
              disabled={enviando}
              aria-label="Volver al paso anterior"
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border transition active:scale-[0.96]"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={avanzar}
            disabled={enviando}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] disabled:opacity-60"
          >
            {enviando ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Enviando…
              </>
            ) : paso === PASOS.length - 1 ? (
              <>
                Enviar reporte
                <Check className="size-5" aria-hidden />
              </>
            ) : (
              <>
                Continuar
                <ArrowRight className="size-5" aria-hidden />
              </>
            )}
          </button>
        </div>
      </footer>
    </Pantalla>
  );
}

// ── Pasos ──────────────────────────────────────────────────────────────────
//
// Las piezas compartidas (Pantalla, Aviso, Campo, Segmentado, ENTRADA y la
// barra de avance) viven en `@/components/form-wizard`: las usa también el
// checklist de vehículos.

function PasoLugar({
  form,
  set,
}: {
  form: Formulario;
  set: <K extends keyof Formulario>(c: K, v: Formulario[K]) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Campo etiqueta="Sitio">
        <input
          className={ENTRADA}
          value={form.sitio}
          onChange={(e) => set('sitio', e.target.value)}
          placeholder="Casa matriz, faena, ruta…"
          autoComplete="off"
        />
      </Campo>
      <Campo etiqueta="Área o lugar exacto">
        <MapaArea
          area={form.area}
          onArea={(v) => set('area', v)}
          coords={form.coords}
          onCoords={(c) => set('coords', c)}
        />
      </Campo>
      <Campo etiqueta="Fecha">
        <SelectorFecha valor={form.fecha} onChange={(v) => set('fecha', v)} />
      </Campo>
      <Campo etiqueta="Hora">
        <SelectorHora valor={form.hora} onChange={(v) => set('hora', v)} />
      </Campo>
      <Campo etiqueta="Turno">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Turno">
          {TURNOS.map((t) => (
            <button
              key={t.valor || 'sin'}
              type="button"
              aria-pressed={form.turno === t.valor}
              onClick={() => set('turno', t.valor)}
              className={`h-11 min-w-[72px] flex-1 rounded-2xl border px-3 text-[15px] font-medium transition active:scale-[0.97] ${
                form.turno === t.valor
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Campo>
    </div>
  );
}

function PasoConsecuencias({
  form,
  set,
}: {
  form: Formulario;
  set: <K extends keyof Formulario>(c: K, v: Formulario[K]) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {CONSECUENCIAS.map((c) => {
        const activa = form.marcadas[c.key];
        return (
          <div key={c.key} className="flex flex-col gap-3">
            <button
              type="button"
              aria-pressed={activa}
              onClick={() => set('marcadas', { ...form.marcadas, [c.key]: !activa })}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.99] ${
                activa ? 'border-primary bg-primary/10' : 'border-border bg-card'
              }`}
            >
              <span className="text-[16px] font-medium">{c.label}</span>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  activa ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                }`}
              >
                {activa && <Check className="size-4" aria-hidden />}
              </span>
            </button>
            {activa && c.detalle && (
              <input
                className={`${ENTRADA} -mt-1`}
                value={form[c.detalle] as string}
                onChange={(e) => set(c.detalle, e.target.value)}
                placeholder={c.pista ?? ''}
                autoComplete="off"
              />
            )}
          </div>
        );
      })}
      <Campo etiqueta="¿Hubo tiempo perdido?">
        <Segmentado
          valor={form.tiempoPerdido}
          onChange={(v) => set('tiempoPerdido', v as Formulario['tiempoPerdido'])}
          opciones={[
            { valor: 'CON', label: 'Sí' },
            { valor: 'SIN', label: 'No' },
            { valor: '', label: 'No sé' },
          ]}
        />
      </Campo>
    </div>
  );
}

function PasoRelato({
  form,
  set,
}: {
  form: Formulario;
  set: <K extends keyof Formulario>(c: K, v: Formulario[K]) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <Campo etiqueta="Descripción del incidente" hint="Breve, certera y sin suposiciones.">
        <textarea
          className="min-h-36 w-full rounded-2xl border border-border bg-card p-4 text-[16px] leading-snug outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
          value={form.descripcion}
          onChange={(e) => set('descripcion', e.target.value)}
          placeholder="Conductor se dirige a mantención cuando, al ingresar a la calle…"
          maxLength={2000}
        />
      </Campo>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">
          Acciones inmediatas adoptadas
        </span>
        {form.acciones.map((accion, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={ENTRADA}
              value={accion}
              onChange={(e) =>
                set(
                  'acciones',
                  form.acciones.map((a, j) => (j === i ? e.target.value : a)),
                )
              }
              placeholder={i === 0 ? 'Se informa a la jefatura' : 'Otra acción'}
              autoComplete="off"
            />
            {form.acciones.length > 1 && (
              <button
                type="button"
                aria-label={`Quitar acción ${i + 1}`}
                onClick={() => set('acciones', form.acciones.filter((_, j) => j !== i))}
                className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border text-muted-foreground transition active:scale-[0.96]"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
        {form.acciones.length < 5 && (
          <button
            type="button"
            onClick={() => set('acciones', [...form.acciones, ''])}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-[15px] font-medium text-muted-foreground transition active:scale-[0.98]"
          >
            <Plus className="size-4" aria-hidden />
            Agregar otra acción
          </button>
        )}
      </div>
    </div>
  );
}

function PasoFotos({
  fotos,
  onAgregar,
  onQuitar,
}: {
  fotos: FotoLista[];
  onAgregar: (lista: FileList | null) => void;
  onQuitar: (i: number) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        {fotos.map((f, i) => (
          <div key={f.preview} className="relative aspect-square overflow-hidden rounded-2xl border border-border">
            <img src={f.preview} alt={`Foto ${i + 1}`} className="size-full object-cover" />
            {i === 0 && (
              <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[11px] font-medium text-white">
                Va en el reporte
              </span>
            )}
            <button
              type="button"
              aria-label={`Quitar foto ${i + 1}`}
              onClick={() => onQuitar(i)}
              className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        {fotos.length < MAX_FOTOS && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-card text-muted-foreground transition active:scale-[0.98]">
            <Camera className="size-6" aria-hidden />
            <span className="text-[12px] font-medium">Agregar</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                onAgregar(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        Hasta {MAX_FOTOS} fotos. Se achican en tu teléfono antes de subirlas, así que no gastas datos de más.
      </p>
    </div>
  );
}

function PasoReporta({
  form,
  set,
}: {
  form: Formulario;
  set: <K extends keyof Formulario>(c: K, v: Formulario[K]) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Campo etiqueta="Nombre">
        <input
          className={ENTRADA}
          value={form.preparaNombre}
          onChange={(e) => set('preparaNombre', e.target.value)}
          placeholder="Nombre y apellido"
          autoComplete="name"
        />
      </Campo>
      <Campo etiqueta="Cargo">
        <input
          className={ENTRADA}
          value={form.preparaCargo}
          onChange={(e) => set('preparaCargo', e.target.value)}
          placeholder="Supervisor, conductor, APR…"
          autoComplete="organization-title"
        />
      </Campo>
      <Campo etiqueta="Correo (opcional)" hint="Solo por si HSE necesita repreguntar algo.">
        <input
          type="email"
          className={ENTRADA}
          value={form.reporterEmail}
          onChange={(e) => set('reporterEmail', e.target.value)}
          placeholder="nombre@empresa.cl"
          autoComplete="email"
        />
      </Campo>
    </div>
  );
}
