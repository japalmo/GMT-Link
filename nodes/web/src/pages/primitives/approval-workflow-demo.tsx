import { useState } from 'react';
import { FileText, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  ApprovalWorkflow,
  useApprovalWorkflow,
  type ApprovalItem,
} from '@/components/primitives/approval-workflow';

/** Documento de ejemplo que viaja por el flujo de aprobación. */
interface DemoDoc {
  readonly titulo: string;
  readonly contenido: string;
}

const INITIAL_ITEM: ApprovalItem<DemoDoc> = {
  id: 'doc-demo-001',
  status: 'PENDIENTE',
  current: {
    titulo: 'Procedimiento de izaje — Rev. A',
    contenido: 'Borrador inicial enviado a revisión del jefe de QA.',
  },
  submittedBy: 'ana.reyes',
};

/** Render del contenido versionado para el diff. */
function renderDoc(doc: DemoDoc) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-foreground">{doc.titulo}</span>
      <span className="text-sm text-muted-foreground">{doc.contenido}</span>
    </div>
  );
}

/** Demo aislada de la primitiva ApprovalWorkflow (§5). */
export default function ApprovalWorkflowDemo() {
  // En un módulo real esto vendría de OpenFGA (§3.1). Aquí lo togglemos a mano.
  const [canApprove, setCanApprove] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Campos para "enviar nueva versión".
  const [titulo, setTitulo] = useState('Procedimiento de izaje — Rev. B');
  const [contenido, setContenido] = useState(
    'Se incorporan firmas de página 2 y check de carga máxima.',
  );

  const [log, setLog] = useState<ReadonlyArray<string>>([]);

  function appendLog(line: string): void {
    setLog((prev) => [`${new Date().toLocaleTimeString()} · ${line}`, ...prev]);
  }

  const wf = useApprovalWorkflow<DemoDoc>({
    initialItem: INITIAL_ITEM,
    canApprove,
    onNotify: (item) =>
      appendLog(`Notificación al aprobador: nueva versión PENDIENTE (${item.id}).`),
    onApprove: (item) => appendLog(`Aprobado por ${item.reviewedBy}.`),
    onReject: (item) =>
      appendLog(`Rechazado por ${item.reviewedBy}. Motivo: ${item.reason}.`),
  });

  async function handleSubmitNewVersion(): Promise<void> {
    setError(null);
    try {
      await wf.submit({ titulo, contenido }, 'ana.reyes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la versión.');
    }
  }

  async function handleApprove(): Promise<void> {
    setError(null);
    try {
      await wf.approve('jorge.qa');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aprobar.');
    }
  }

  async function handleReject(reason: string): Promise<void> {
    setError(null);
    try {
      await wf.reject('jorge.qa', reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar.');
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">Primitiva · §5</p>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <FileText className="size-6 text-primary" aria-hidden />
          ApprovalWorkflow
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Flujo genérico PENDIENTE → APROBADO / RECHAZADO con conservación de la
          versión anterior y gancho de notificación. La decisión de permisos la
          inyecta el consumidor (aquí, un toggle que simula OpenFGA).
        </p>
      </header>

      {/* Controles de la demo */}
      <Card>
        <CardHeader>
          <CardTitle>Enviar nueva versión</CardTitle>
          <CardDescription>
            Crea una versión PENDIENTE conservando la anterior y notifica al aprobador.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="demo-titulo">Título</Label>
            <Input
              id="demo-titulo"
              value={titulo}
              onChange={(event) => setTitulo(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="demo-contenido">Contenido</Label>
            <Input
              id="demo-contenido"
              value={contenido}
              onChange={(event) => setContenido(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button onClick={handleSubmitNewVersion}>
              <Send aria-hidden />
              Enviar nueva versión
            </Button>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={canApprove}
                onChange={(event) => setCanApprove(event.target.checked)}
              />
              <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
              <span>
                <code className="text-xs">canApprove</code> (simula OpenFGA)
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* La primitiva en acción */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Estado del item</h2>
        <ApprovalWorkflow
          item={wf.item}
          canApprove={wf.canApprove}
          renderValue={renderDoc}
          error={error}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </section>

      {/* Bitácora de transiciones / notificaciones */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Bitácora</h2>
        <Card>
          <CardContent className="pt-6">
            {log.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay transiciones. Envía una versión o aprueba/rechaza.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {log.map((line, index) => (
                  <li
                    key={`${line}-${index}`}
                    className={cn(
                      'rounded-md bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground',
                    )}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
