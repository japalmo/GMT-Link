/**
 * Overlay de "Reportar uso" del catálogo de Recursos: corre TODO el ciclo sin
 * navegar al detalle del activo.
 *
 * Al abrirse reclama el activo de una (`start`, sin foto) y decide el paso:
 * - Si el activo NO tiene checklist, el backend devuelve el ciclo ya EN_CURSO y
 *   el overlay termina ahí (paso `starting`).
 * - Si quedó EN_PREPARACION, carga la plantilla y resuelve el checklist aquí
 *   mismo, firma incluida (paso `checklist`).
 *
 * Reclamado el activo, el paso `checklist` no se cierra por backdrop ni Escape:
 * solo confirmando o cancelando el reporte (si no, el activo quedaría trabado en
 * EN_PREPARACION). El reclamo (sin foto) es una petición rápida, así que durante
 * `starting` solo se puede cerrar si falló (no llegó a reclamarse el activo).
 *
 * La construcción/validación de respuestas (`buildChecklistAnswers`) y el cuerpo
 * del formulario (`ChecklistFillBody`) son los MISMOS que usa el detalle del
 * activo: las dos entradas al checklist no se desincronizan.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getChecklistTemplate } from '@/lib/api';
import { useUsageCycles } from '@/hooks/use-usage-cycles';
import { useAuth } from '@/context/auth-context';
import { ChecklistFillBody } from './checklist-fill-body';
import { useChecklistSignature } from './checklist-signature-dialog';
import { buildChecklistAnswers } from './checklist-answers';
import type {
  ChecklistSignatureInput,
  ChecklistTemplateView,
  UsageCycleView,
} from '@/types/assets';

/** Datos mínimos del activo a reportar (los que muestra la fila de la tabla). */
export interface ReportarUsoAsset {
  id: string;
  name: string;
  code: string;
}

export interface ReportarUsoOverlayProps {
  /** Activo a reportar; `null` = cerrado. */
  asset: ReportarUsoAsset | null;
  onClose: () => void;
  /** Se llama tras completar/cancelar con éxito para refrescar la tabla. */
  onCompleted: () => void;
}

/** Paso activo del overlay. */
type Step = 'starting' | 'checklist';

export function ReportarUsoOverlay({
  asset,
  onClose,
  onCompleted,
}: ReportarUsoOverlayProps): ReactNode {
  const { start, confirm, cancel } = useUsageCycles();
  const { user } = useAuth();
  const { requestSignature, dialog: signatureDialog } = useChecklistSignature();

  const [step, setStep] = useState<Step>('starting');
  const [cycle, setCycle] = useState<UsageCycleView | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplateView | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // Guarda de doble envío: cubre reportar, confirmar y cancelar (la firma puede
  // tardar, y el ciclo no admite dos mutaciones en vuelo).
  const [submitting, setSubmitting] = useState(false);
  // Reclamo idempotente: garantiza que el activo se reclame UNA sola vez por
  // apertura, aunque el efecto se re-ejecute por cambios de identidad de props.
  const claimedFor = useRef<string | null>(null);

  const assetId = asset?.id ?? null;

  /** Cierra tras una acción exitosa, avisando al contenedor para que recargue. */
  const finish = useCallback(() => {
    onCompleted();
    onClose();
  }, [onCompleted, onClose]);

  /** Carga la plantilla del checklist del activo (reutilizable para reintentar). */
  const loadTemplate = useCallback(async (assetIdArg: string): Promise<void> => {
    setLoadingTemplate(true);
    setTemplateError(null);
    try {
      setTemplate(await getChecklistTemplate(assetIdArg));
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : 'No se pudo cargar el checklist del activo.',
      );
    } finally {
      setLoadingTemplate(false);
    }
  }, []);

  /** Reclama el activo (sin foto) y decide el paso: EN_CURSO termina, EN_PREPARACION abre el checklist. */
  const runStart = useCallback(
    async (a: ReportarUsoAsset): Promise<void> => {
      setSubmitting(true);
      setStartError(null);
      try {
        const { cycle: started } = await start(a.id);
        // Sin checklist configurado el backend deja el ciclo EN_CURSO de una: no hay
        // nada más que preguntar.
        if (started.status === 'EN_CURSO') {
          toast.success('Activo puesto en uso con éxito.');
          finish();
          return;
        }
        setCycle(started);
        setStep('checklist');
        await loadTemplate(a.id);
      } catch (err) {
        setStartError(err instanceof Error ? err.message : 'No se pudo reportar el uso del activo.');
      } finally {
        setSubmitting(false);
      }
    },
    [start, finish, loadTemplate],
  );

  // El overlay se REMONTA por activo (el padre lo monta con key={asset.id}), así que
  // cada apertura arranca con el estado inicial limpio: no hace falta un efecto de
  // reset (que además, en StrictMode, reescribiría `submitting` a false y podría
  // abrir la puerta a cerrar durante el reclamo). `submitting` lo maneja runStart.

  // Reclama el activo apenas se abre, una sola vez por apertura (el ref evita el
  // doble reclamo aunque runStart cambie de identidad al re-renderizar el padre).
  useEffect(() => {
    if (!asset || claimedFor.current === asset.id) return;
    claimedFor.current = asset.id;
    void runStart(asset);
  }, [asset, runStart]);

  // Escape solo cierra en el paso 'starting' y SOLO si no hay nada en vuelo: durante
  // el reclamo (submitting) cerrar dejaría el activo trabado EN_PREPARACION; una vez
  // en 'checklist' el activo ya está reclamado y solo se sale confirmando/cancelando.
  useEffect(() => {
    if (assetId === null || step !== 'starting' || submitting) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assetId, step, submitting, onClose]);

  /** Fija la respuesta de un ítem (o de su observación companion). */
  const setAnswer = useCallback((key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  /**
   * Paso 'checklist': firma (si es obligatoria) y confirma el ciclo. El `<form>` y
   * su `onSubmit` los provee este contenedor; el botón de envío vive dentro de
   * `ChecklistFillBody` (que además valida página por página antes de enviar).
   */
  const handleConfirm = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!asset || !cycle || !template || submitting) return;
    setSubmitting(true);
    try {
      const built = buildChecklistAnswers(template, answers);

      // Firma verificada (#68): con el MISMO {templateId, answers} que irá al
      // confirm. Si el usuario cancela la firma, no se envía nada (el ciclo sigue
      // EN_PREPARACION y el overlay queda abierto para reintentar o cancelar).
      let signature: ChecklistSignatureInput | undefined;
      if (user?.checklistSignatureRequired) {
        const sig = await requestSignature(asset.id, template.id, built);
        if (!sig) return;
        signature = sig;
      }

      const { asset: updated } = await confirm(asset.id, cycle.id, template.id, built, signature);
      if (updated.status === 'MANTENIMIENTO') {
        toast.warning('El checklist reportó una falla: el activo quedó en mantenimiento.');
      } else {
        toast.success('Checklist firmado. El activo quedó en uso.');
      }
      finish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo confirmar el checklist.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Paso 'checklist': suelta el activo reclamado (vuelve a DISPONIBLE). */
  const handleCancelReport = async (): Promise<void> => {
    if (!asset || !cycle || submitting) return;
    setSubmitting(true);
    try {
      await cancel(asset.id, cycle.id);
      toast.success('Reporte de uso cancelado.');
      finish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cancelar el reporte de uso.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!asset) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      // El backdrop solo cierra en el paso 'starting' sin nada en vuelo (el reclamo
      // falló o aún no empezó): en 'checklist' el activo ya está reclamado y salir sin
      // cancelar lo dejaría trabado.
      onClick={(e) => {
        if (step === 'starting' && !submitting && e.target === e.currentTarget) onClose();
      }}
    >
      {step === 'starting' ? (
        <Card className="w-full max-w-sm bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
          <CardHeader>
            <CardTitle>Reportar uso</CardTitle>
            <CardDescription>
              {asset.name} · {asset.code}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {startError ? (
              <div
                role="alert"
                className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive"
              >
                {startError}
              </div>
            ) : (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                Reclamando el activo…
              </p>
            )}
          </CardContent>
          {startError && (
            <CardFooter className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
              <Button type="button" onClick={() => void runStart(asset)}>
                Reintentar
              </Button>
            </CardFooter>
          )}
        </Card>
      ) : (
        <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
          <form onSubmit={(e) => void handleConfirm(e)}>
            <CardHeader>
              <CardTitle>Checklist de {asset.name}</CardTitle>
              <CardDescription>
                Completa la inspección inicial para dejar el activo en uso.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {loadingTemplate && (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Cargando el checklist…
                </p>
              )}

              {templateError && (
                <div
                  role="alert"
                  className="flex flex-col gap-2 p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive"
                >
                  <span>{templateError}</span>
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loadingTemplate}
                      onClick={() => void loadTemplate(asset.id)}
                    >
                      Reintentar
                    </Button>
                  </div>
                </div>
              )}

              {!loadingTemplate && template && (
                <ChecklistFillBody
                  template={template}
                  answers={answers}
                  setAnswer={setAnswer}
                  submitting={submitting}
                />
              )}
            </CardContent>
            <CardFooter className="flex justify-start">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleCancelReport()}
                disabled={submitting}
              >
                Cancelar reporte
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* El diálogo de firma vive DENTRO del overlay: si no, quedaría por debajo
          del backdrop y la firma no se podría completar. */}
      {signatureDialog}
    </div>
  );
}
