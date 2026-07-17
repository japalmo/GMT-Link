/**
 * Overlay de "Reportar uso" del catálogo de Recursos: corre TODO el ciclo sin
 * navegar al detalle del activo.
 *
 * Máquina de dos pasos:
 * - `foto`: reclama el activo (`start`) con una foto inicial OPCIONAL. Si el activo
 *   no tiene checklist el backend devuelve el ciclo ya EN_CURSO y se termina ahí.
 * - `checklist`: si el ciclo quedó EN_PREPARACION, se carga la plantilla y se
 *   resuelve el checklist aquí mismo (firma incluida).
 *
 * Una vez abierto el ciclo el activo queda RECLAMADO: en el paso `checklist` el
 * overlay no se cierra por backdrop ni Escape, solo confirmando o cancelando el
 * reporte (si no, el activo quedaría trabado en EN_PREPARACION).
 *
 * La construcción/validación de respuestas (`buildChecklistAnswers`) y el cuerpo
 * del formulario (`ChecklistFillBody`) son los MISMOS que usa el detalle del
 * activo: las dos entradas al checklist no se desincronizan.
 */
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ClipboardCheck, ImagePlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
type Step = 'foto' | 'checklist';

export function ReportarUsoOverlay({
  asset,
  onClose,
  onCompleted,
}: ReportarUsoOverlayProps): ReactNode {
  const { start, confirm, cancel } = useUsageCycles();
  const { user } = useAuth();
  const { requestSignature, dialog: signatureDialog } = useChecklistSignature();
  const photoInputId = useId();

  const [step, setStep] = useState<Step>('foto');
  const [photo, setPhoto] = useState<File | null>(null);
  const [cycle, setCycle] = useState<UsageCycleView | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplateView | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // Guarda de doble envío: cubre reportar, confirmar y cancelar (la firma puede
  // tardar, y el ciclo no admite dos mutaciones en vuelo).
  const [submitting, setSubmitting] = useState(false);

  const assetId = asset?.id ?? null;

  // Cada apertura arranca limpia: el overlay vive montado en la tabla y se reusa
  // para cualquier fila, así que no puede heredar el ciclo/plantilla del anterior.
  useEffect(() => {
    if (assetId === null) return;
    setStep('foto');
    setPhoto(null);
    setCycle(null);
    setTemplate(null);
    setTemplateError(null);
    setLoadingTemplate(false);
    setAnswers({});
    setSubmitting(false);
  }, [assetId]);

  // Escape solo cierra en el paso 'foto' y SOLO si no hay nada en vuelo: si se cierra
  // mientras `start` está reclamando el activo (una foto por 4G tarda segundos), el
  // ciclo igual se crea y el activo queda trabado EN_PREPARACION sin overlay que lo
  // confirme ni lo cancele. Mismo criterio que el backdrop.
  useEffect(() => {
    if (assetId === null || step !== 'foto' || submitting) return;
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

  /** Cierra tras una acción exitosa, avisando al contenedor para que recargue. */
  const finish = useCallback(() => {
    onCompleted();
    onClose();
  }, [onCompleted, onClose]);

  /** Carga la plantilla del checklist del activo (paso 'checklist'). */
  const loadTemplate = async (id: string): Promise<void> => {
    setLoadingTemplate(true);
    setTemplateError(null);
    try {
      setTemplate(await getChecklistTemplate(id));
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : 'No se pudo cargar el checklist del activo.',
      );
    } finally {
      setLoadingTemplate(false);
    }
  };

  /** Paso 'foto': reclama el activo y decide si hay checklist que completar. */
  const handleStart = async (): Promise<void> => {
    if (!asset || submitting) return;
    setSubmitting(true);
    try {
      const { cycle: started } = await start(asset.id, photo ?? undefined);
      // Sin checklist configurado el backend deja el ciclo EN_CURSO de una: no hay
      // nada más que preguntar.
      if (started.status === 'EN_CURSO') {
        toast.success('Activo puesto en uso con éxito.');
        finish();
        return;
      }
      setCycle(started);
      setStep('checklist');
      await loadTemplate(asset.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo reportar el uso del activo.');
    } finally {
      setSubmitting(false);
    }
  };

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
      // El backdrop solo cierra en el paso 'foto': en 'checklist' el activo ya está
      // reclamado y salir sin cancelar lo dejaría trabado.
      onClick={(e) => {
        if (step === 'foto' && e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      {step === 'foto' ? (
        <Card className="w-full max-w-sm bg-card shadow-lg border border-border animate-in fade-in zoom-in duration-200">
          <CardHeader>
            <CardTitle>Reportar uso</CardTitle>
            <CardDescription>
              {asset.name} · {asset.code}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Reclamas el activo y completas el checklist inicial. La foto es opcional.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={photoInputId}>Foto inicial (opcional)</Label>
              <input
                id={photoInputId}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
              />
              {photo && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ImagePlus className="size-3.5 text-primary" aria-hidden />
                  {photo.name}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleStart()} loading={submitting}>
              <ClipboardCheck className="size-3.5 mr-1.5" />
              Reportar uso
            </Button>
          </CardFooter>
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
                  className="p-3 text-xs rounded-lg border border-destructive/20 bg-destructive/5 text-destructive"
                >
                  {templateError}
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
