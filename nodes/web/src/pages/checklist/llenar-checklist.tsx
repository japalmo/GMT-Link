import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Loader2 } from 'lucide-react';

import { BrandLogo } from '@/components/branding/brand-logo';
import { Aviso, BarraPasos, Campo, ENTRADA, FirmaCanvas, Pantalla } from '@/components/form-wizard';
import {
  downloadChecklistPdf,
  downloadPublicChecklistPdf,
  errorToMessage,
  getChecklistTemplate,
  getPublicAsset,
  getPublicChecklistTemplate,
  resolveAssetByToken,
  submitChecklist,
  submitPublicChecklist,
} from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import type { ChecklistSignatureInput, ChecklistTemplateView } from '@/types/assets';
import { ChecklistFillBody, problemaDeSeccion } from '@/pages/recursos/checklist-fill-body';
import { buildChecklistAnswers } from '@/pages/recursos/checklist-answers';
import { useChecklistSignature } from '@/pages/recursos/checklist-signature-dialog';
import { PasoIdentificacion } from './paso-identificacion';
import { PasoConductor, type DatosConductor } from './paso-conductor';

/**
 * Checklist de un activo, como asistente por pasos.
 *
 * Se llega desde el QR de la plaquita del vehículo. Funciona CON y SIN sesión:
 * en faena hay conductores de terceros y gente que todavía no tiene cuenta, y
 * exigir login significaba que el checklist no se hiciera. Quien no tiene
 * sesión elige primero cómo llenarlo; quien la tiene entra directo a sus datos.
 *
 * Los pasos del medio son las secciones de la plantilla, y los dibuja
 * `ChecklistFillBody` en modo "sección externa": la navegación la lleva esta
 * página, para que no haya dos barras de avance compitiendo en la pantalla.
 *
 * Es una página aparte del detalle del recurso a propósito (pedido del dueño):
 * el conductor no tiene permiso para entrar a la ficha del vehículo.
 */

/** Un paso del asistente. */
type Paso =
  | { clase: 'identificacion' }
  | { clase: 'conductor' }
  | { clase: 'seccion'; id: string; titulo: string; descripcion?: string }
  | { clase: 'cierre' };

const DATOS_VACIOS: DatosConductor = {
  nombre: '',
  correo: '',
  claseLicencia: '',
  venceLicencia: '',
  venceInterna: '',
};

export function LlenarChecklistPage(): ReactNode {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { requestSignature, dialog: signatureDialog } = useChecklistSignature();
  const inicioRef = useRef<HTMLDivElement>(null);

  const [assetId, setAssetId] = useState<string | null>(null);
  const [rotulo, setRotulo] = useState('');
  const [template, setTemplate] = useState<ChecklistTemplateView | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [datos, setDatos] = useState<DatosConductor>(DATOS_VACIOS);
  const [firma, setFirma] = useState<string | null>(null);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [paso, setPaso] = useState(0);
  const [listo, setListo] = useState<{ id: string; correoEnviado: boolean } | null>(null);

  const setAnswer = useCallback((key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);
  const setDato = useCallback(
    <K extends keyof DatosConductor>(campo: K, valor: DatosConductor[K]) => {
      setDatos((prev) => ({ ...prev, [campo]: valor }));
    },
    [],
  );

  // Carga: con sesión se resuelve el token al activo (y de paso autoriza); sin
  // ella se usan los endpoints públicos, donde el token es la credencial.
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setCargando(true);
    setErrorCarga(null);

    const carga = user
      ? resolveAssetByToken(token).then(async (a) => ({
          id: a.id,
          rotulo: [a.name, a.identifier].filter(Boolean).join(' · '),
          tpl: await getChecklistTemplate(a.id),
        }))
      : getPublicAsset(token).then(async (a) => ({
          id: '',
          rotulo: [a.name, a.code].filter(Boolean).join(' · '),
          tpl: await getPublicChecklistTemplate(token),
        }));

    carga
      .then(({ id, rotulo: r, tpl }) => {
        if (!vivo) return;
        setAssetId(id);
        setRotulo(r);
        setTemplate(tpl);
      })
      .catch((e: unknown) => {
        if (vivo) setErrorCarga(errorToMessage(e, 'No se pudo cargar el checklist.'));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token, user]);

  // Los pasos salen de la plantilla: una página por sección con ítems visibles.
  // Así el asistente sirve para cualquier checklist, no solo el de camionetas.
  const pasos = useMemo<Paso[]>(() => {
    if (!template) return [];
    const obsIds = new Set(
      template.items.map((i) => i.config?.obsItemId).filter((v): v is string => Boolean(v)),
    );
    const visibles = template.items.filter((i) => !obsIds.has(i.id));
    const secciones: Paso[] = (template.sections ?? [])
      .filter((s) => visibles.some((i) => i.section === s.id))
      .map((s) => ({
        clase: 'seccion',
        id: s.id,
        titulo: s.title,
        ...(s.description ? { descripcion: s.description } : {}),
      }));
    return [
      ...(user ? [] : [{ clase: 'identificacion' as const }]),
      { clase: 'conductor' as const },
      ...secciones,
      { clase: 'cierre' as const },
    ];
  }, [template, user]);

  const actual = pasos[paso];
  const esUltimo = paso === pasos.length - 1;

  /** Qué impide avanzar desde el paso actual, o `null`. */
  function problemaDelPaso(): string | null {
    if (!actual || !template) return null;
    if (actual.clase === 'conductor') {
      if (datos.nombre.trim() === '') return 'Escribe tu nombre para poder registrar el checklist.';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo.trim())) {
        return 'Escribe un correo válido: ahí te llega el PDF.';
      }
      return null;
    }
    if (actual.clase === 'seccion') {
      const obsIds = new Set(
        template.items.map((i) => i.config?.obsItemId).filter((v): v is string => Boolean(v)),
      );
      const items = template.items.filter((i) => i.section === actual.id && !obsIds.has(i.id));
      return problemaDeSeccion(items, answers);
    }
    return null;
  }

  function avanzar(): void {
    const problema = problemaDelPaso();
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    if (esUltimo) {
      void enviar();
      return;
    }
    setPaso((p) => p + 1);
    inicioRef.current?.scrollIntoView({ block: 'start' });
  }

  async function enviar(): Promise<void> {
    if (!template || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const respuestas = buildChecklistAnswers(template, { ...answers, ...firmaEnRespuesta() });

      if (user && assetId) {
        // Camino autenticado: conserva la firma verificada cuando es obligatoria.
        let signature: ChecklistSignatureInput | undefined;
        if (user.checklistSignatureRequired) {
          const sig = await requestSignature(assetId, template.id, respuestas);
          if (!sig) {
            setEnviando(false);
            return;
          }
          signature = sig;
        }
        const envio = await submitChecklist(assetId, {
          templateId: template.id,
          answers: respuestas,
          signature,
        });
        setListo({ id: envio.id, correoEnviado: envio.correoEnviado ?? false });
      } else {
        const envio = await submitPublicChecklist(token ?? '', {
          templateId: template.id,
          answers: respuestas,
          declaredName: datos.nombre.trim(),
          declaredEmail: datos.correo.trim(),
          ...(datos.claseLicencia ? { declaredLicenseClass: datos.claseLicencia } : {}),
          ...(datos.venceLicencia ? { declaredLicenseExpiry: datos.venceLicencia } : {}),
          ...(datos.venceInterna ? { declaredInternalExpiry: datos.venceInterna } : {}),
        });
        setListo({ id: envio.id, correoEnviado: envio.correoEnviado ?? false });
      }
    } catch (e: unknown) {
      setError(errorToMessage(e, 'No se pudo enviar el checklist.'));
    } finally {
      setEnviando(false);
    }
  }

  /** La firma trazada, como respuesta del ítem FIRMA de la plantilla. */
  function firmaEnRespuesta(): Record<string, unknown> {
    const item = template?.items.find((i) => i.type === 'FIRMA');
    return item && firma ? { [item.id]: firma } : {};
  }

  if (cargando) {
    return (
      <Pantalla>
        <div className="flex flex-1 items-center justify-center gap-2 text-[15px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando el checklist…
        </div>
      </Pantalla>
    );
  }

  if (errorCarga || !template || pasos.length === 0) {
    return (
      <Pantalla>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Aviso mensaje={errorCarga ?? 'Este activo no tiene preguntas configuradas.'} />
          <button
            type="button"
            onClick={() => navigate('/')}
            className="h-11 rounded-2xl border border-border px-5 text-[15px] font-medium"
          >
            Volver al inicio
          </button>
        </div>
      </Pantalla>
    );
  }

  if (listo) {
    return (
      <Pantalla>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
          <CheckCircle2 className="size-14 text-emerald-500" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight">Checklist registrado</h1>
            <p className="text-[15px] leading-snug text-muted-foreground">
              {listo.correoEnviado
                ? `Te lo enviamos a ${datos.correo.trim()}.`
                : 'Quedó guardado, pero no pudimos enviarte el correo. Descárgalo acá.'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            {(
              <button
                type="button"
                onClick={() => void descargar(assetId, token ?? '', listo.id)}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground"
              >
                <Download className="size-5" aria-hidden /> Descargar PDF
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="h-12 rounded-2xl border border-border text-[16px] font-medium"
            >
              Listo
            </button>
          </div>
        </div>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <div ref={inicioRef} />
      <header className="flex flex-col gap-4 pt-2">
        <div className="flex items-center justify-between gap-3">
          <BrandLogo className="h-12 w-auto" />
          <span className="text-[13px] font-medium text-muted-foreground">
            Paso {paso + 1} de {pasos.length}
          </span>
        </div>
        <BarraPasos paso={paso} total={pasos.length} />
      </header>

      <main className="flex flex-1 flex-col gap-6 pb-32 pt-7">
        <div
          key={paso}
          className="flex flex-col gap-6 duration-300 animate-in fade-in slide-in-from-right-4 motion-reduce:animate-none"
        >
          <div className="flex flex-col gap-1.5">
            <h1 className="text-balance text-[27px] font-semibold leading-tight tracking-tight">
              {tituloDe(actual)}
            </h1>
            <p className="text-[15px] leading-snug text-muted-foreground">
              {subtituloDe(actual, rotulo)}
            </p>
          </div>

          {actual?.clase === 'identificacion' && (
            <PasoIdentificacion
              onEntrar={() =>
                navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)
              }
              onContinuarSinCuenta={() => setPaso((p) => p + 1)}
            />
          )}

          {actual?.clase === 'conductor' && (
            <PasoConductor usuario={user ?? null} datos={datos} set={setDato} />
          )}

          {actual?.clase === 'seccion' && (
            <ChecklistFillBody
              template={template}
              answers={answers}
              setAnswer={setAnswer}
              submitting={enviando}
              seccionExterna={actual.id}
            />
          )}

          {actual?.clase === 'cierre' && (
            <div className="flex flex-col gap-4">
              <Campo etiqueta="Correo" hint="Ahí te llega el PDF del checklist.">
                <input
                  className={ENTRADA}
                  type="email"
                  inputMode="email"
                  value={datos.correo}
                  onChange={(e) => setDato('correo', e.target.value)}
                  placeholder="tu@correo.cl"
                  autoComplete="email"
                />
              </Campo>
              {template.items.some((i) => i.type === 'FIRMA') && (
                <Campo etiqueta="Firma">
                  <FirmaCanvas valor={firma} onChange={setFirma} />
                </Campo>
              )}
            </div>
          )}
        </div>
        {error && <Aviso mensaje={error} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
          {paso > 0 && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPaso((p) => p - 1);
              }}
              disabled={enviando}
              aria-label="Volver al paso anterior"
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border transition active:scale-[0.96]"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}
          {/* En el paso de identificación el avance lo dan las tarjetas. */}
          {actual?.clase !== 'identificacion' && (
            <button
              type="button"
              onClick={avanzar}
              disabled={enviando}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] disabled:opacity-60"
            >
              {enviando ? (
                <>
                  <Loader2 className="size-5 animate-spin" aria-hidden /> Enviando…
                </>
              ) : esUltimo ? (
                <>
                  Enviar checklist <Check className="size-5" aria-hidden />
                </>
              ) : (
                <>
                  Continuar <ArrowRight className="size-5" aria-hidden />
                </>
              )}
            </button>
          )}
        </div>
      </footer>

      {signatureDialog}
    </Pantalla>
  );
}

function tituloDe(paso: Paso | undefined): string {
  if (!paso) return '';
  switch (paso.clase) {
    case 'identificacion':
      return '¿Cómo quieres llenarlo?';
    case 'conductor':
      return 'Tus datos';
    case 'cierre':
      return 'Cierre';
    default:
      return paso.titulo;
  }
}

function subtituloDe(paso: Paso | undefined, rotulo: string): string {
  if (!paso) return '';
  switch (paso.clase) {
    case 'identificacion':
      return `Vas a llenar el checklist de ${rotulo}.`;
    case 'conductor':
      return 'Quedan registrados en el checklist que vas a firmar.';
    case 'cierre':
      return 'Revisa el correo y firma para cerrar el checklist.';
    default:
      return paso.descripcion ?? `Checklist de ${rotulo}.`;
  }
}

/**
 * Descarga el PDF por el camino que corresponda: con sesión, el endpoint
 * normal; sin ella, el público por token. La pantalla de éxito ofrece la
 * descarga en los dos casos, y más aún cuando el correo no salió.
 */
async function descargar(
  assetId: string | null,
  token: string,
  submissionId: string,
): Promise<void> {
  const blob = assetId
    ? await downloadChecklistPdf(assetId, submissionId)
    : await downloadPublicChecklistPdf(token, submissionId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `checklist-${submissionId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default LlenarChecklistPage;
