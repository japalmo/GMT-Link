import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ClipboardCheck, Loader2, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandLogo } from '@/components/branding/brand-logo';
import {
  resolveAssetByToken,
  getChecklistTemplate,
  submitChecklist,
  downloadChecklistPdf,
} from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import type {
  AssetPublicResolved,
  ChecklistTemplateView,
  ChecklistSignatureInput,
} from '@/types/assets';
import { ChecklistFillBody } from '@/pages/recursos/checklist-fill-body';
import { buildChecklistAnswers } from '@/pages/recursos/checklist-answers';
import { useChecklistSignature } from '@/pages/recursos/checklist-signature-dialog';

/**
 * Formulario de checklist INDEPENDIENTE de la vista detalle del recurso.
 *
 * El conductor llega desde el QR de la plaquita del vehículo: la ficha pública
 * (sin login) tiene un botón "Llenar checklist" que apunta acá con el token. Al
 * ser una ruta protegida, quien no tenga sesión pasa por el login y vuelve solo.
 *
 * Es una página aparte a propósito (pedido del dueño): el conductor NO tiene
 * permiso para entrar al detalle del vehículo, y el checklist no puede vivir
 * dentro de esa vista. Acá solo resuelve el token al activo y usa los endpoints
 * normales de plantilla y envío, que ya autorizan al rol conductor
 * (`asset:checklist:run:any`).
 */
export function LlenarChecklistPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const { requestSignature, dialog: signatureDialog } = useChecklistSignature();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<AssetPublicResolved | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplateView | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);

  const setAnswer = useCallback((key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    // Se resuelve el token al activo y, con su id, se carga la plantilla. Los dos
    // endpoints autorizan al conductor sobre los vehículos de flota.
    resolveAssetByToken(token)
      .then(async (a) => {
        const tpl = await getChecklistTemplate(a.id);
        if (!vivo) return;
        setAsset(a);
        setTemplate(tpl);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar el checklist.');
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!asset || !template || enviando) return;
    setEnviando(true);
    try {
      const answerArray = buildChecklistAnswers(template, answers);

      // Firma verificada: solo si el usuario la tiene obligatoria. Mismo
      // {templateId, answers} que va al envío. Si cancela, no se envía nada.
      let signature: ChecklistSignatureInput | undefined;
      if (user?.checklistSignatureRequired) {
        const sig = await requestSignature(asset.id, template.id, answerArray);
        if (!sig) {
          setEnviando(false);
          return;
        }
        signature = sig;
      }

      const submission = await submitChecklist(asset.id, {
        templateId: template.id,
        answers: answerArray,
        signature,
      });
      setListo(true);
      toast.success('Checklist enviado. Gracias.', {
        action: {
          label: 'Descargar PDF',
          onClick: () => {
            void descargarPdf(asset.id, submission.id);
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el checklist.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <BrandLogo className="h-7" />
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-1.5 size-4" /> Inicio
        </Button>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando el checklist…
        </div>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle>No se pudo abrir el checklist</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate('/')}>
              Volver al inicio
            </Button>
          </CardContent>
        </Card>
      ) : listo ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-emerald-500" /> Checklist enviado
            </CardTitle>
            <CardDescription>
              Quedó registrado para {asset?.name}
              {asset?.identifier ? ` (${asset.identifier})` : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAnswers({});
                setListo(false);
              }}
            >
              Llenar otro
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Ir al inicio
            </Button>
          </CardContent>
        </Card>
      ) : asset && template ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="size-5 text-primary" /> {template.name}
            </CardTitle>
            <CardDescription>
              {asset.name}
              {asset.identifier ? ` · ${asset.identifier}` : ''} · {asset.code}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <ChecklistFillBody
                template={template}
                answers={answers}
                setAnswer={setAnswer}
                submitting={enviando}
              />
            </form>
          </CardContent>
        </Card>
      ) : null}

      {signatureDialog}
    </div>
  );
}

async function descargarPdf(assetId: string, submissionId: string): Promise<void> {
  try {
    const blob = await downloadChecklistPdf(assetId, submissionId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklist-${submissionId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error('No se pudo descargar el PDF.');
  }
}

export default LlenarChecklistPage;
