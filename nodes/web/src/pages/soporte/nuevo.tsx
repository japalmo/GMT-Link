import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import * as api from '@/lib/api';
import { errorToMessage } from '@/lib/api';
import type {
  TicketFrequency,
  TicketPeopleAffected,
  TicketType,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import {
  TICKET_FREQUENCY_LABELS,
  TICKET_MODULES,
  TICKET_PEOPLE_LABELS,
  TICKET_TYPE_HINTS,
  TICKET_TYPE_LABELS,
} from './soporte-shared';

const TIPOS = Object.keys(TICKET_TYPE_LABELS) as TicketType[];

/** Campo con etiqueta y texto de ayuda. La ayuda es lo que evita que se llene mal. */
function Campo({
  htmlFor,
  label,
  hint,
  required,
  children,
}: {
  htmlFor?: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Levantar un ticket a Informática (PR-TI-01). Accesible a todo usuario
 * autenticado: el procedimiento dice que cualquier área puede pedir.
 */
export default function SoporteNuevoPage() {
  const navigate = useNavigate();

  const [type, setType] = useState<TicketType>('REQUERIMIENTO');
  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerAck, setManagerAck] = useState(false);
  const [modulo, setModulo] = useState('');
  const [expected, setExpected] = useState('');
  const [impact, setImpact] = useState('');
  const [peopleAffected, setPeopleAffected] = useState<TicketPeopleAffected>('RANGO_1_3');
  const [frequency, setFrequency] = useState<TicketFrequency>('SEMANAL');
  const [dueDate, setDueDate] = useState('');
  const [milestone, setMilestone] = useState('');

  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void api
      .listDepartments()
      .then((d) => {
        if (vivo) setDepartments(d);
      })
      .catch(() => {
        if (vivo) setDepartments([]);
      });
    void api
      .listProjects()
      .then((p) => {
        if (vivo) setProjects(p.map((x) => ({ id: x.id, name: x.name })));
      })
      .catch(() => {
        if (vivo) setProjects([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) return setError('El título es obligatorio.');
    if (!departmentId) return setError('Indica el área que levanta la solicitud.');
    if (!managerName.trim()) return setError('Identifica la jefatura que respalda.');
    if (!modulo) return setError('Indica el módulo afectado.');
    if (!expected.trim()) return setError('Describe qué necesitas que el sistema haga.');
    if (!impact.trim()) return setError('Describe qué pasa hoy si esto no existe.');
    if (!managerAck) return setError('Debes confirmar que tu jefatura respalda esta solicitud.');

    setEnviando(true);
    try {
      const creado = await api.createTicket({
        type,
        title: title.trim(),
        departmentId,
        projectId: projectId || undefined,
        managerName: managerName.trim(),
        managerAck,
        module: modulo,
        expected: expected.trim(),
        impact: impact.trim(),
        peopleAffected,
        frequency,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        milestone: milestone.trim() || undefined,
      });
      toast.success(`Solicitud ${creado.ticketNumber} creada.`);
      navigate('/operaciones/mis-solicitudes');
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo crear el ticket.'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <PageContainer maxWidth="3xl">
      <PageHeader
        label="Soporte TI"
        title="Levantar un ticket a Informática"
        description="Este es el canal formal. Lo que registres acá queda con estado, responsable y trazabilidad."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de la solicitud</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Campo label="Tipo" required hint={TICKET_TYPE_HINTS[type]}>
              <div className="flex flex-wrap gap-2">
                {TIPOS.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={type === t ? 'default' : 'outline'}
                    onClick={() => setType(t)}
                    disabled={enviando}
                  >
                    {TICKET_TYPE_LABELS[t]}
                  </Button>
                ))}
              </div>
            </Campo>

            <Campo
              htmlFor="tk-title"
              label="Título"
              required
              hint="Una frase que resuma el pedido, como la escribirías en un correo."
            >
              <Input
                id="tk-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Registrar consumo de combustible por vehículo y faena"
                maxLength={200}
                disabled={enviando}
              />
            </Campo>

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                htmlFor="tk-dept"
                label="Área que levanta"
                required
                hint="El área a la que perteneces, no la que resolverá."
              >
                <Select
                  id="tk-dept"
                  aria-label="Área que levanta la solicitud"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  disabled={enviando}
                >
                  <option value="">Selecciona un área</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Campo>

              <Campo
                htmlFor="tk-manager"
                label="Jefatura que respalda"
                required
                hint="Sin jefatura identificada el ticket no entra a priorización: Informática ejecuta prioridades, no decide las de otra área."
              >
                <Input
                  id="tk-manager"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  placeholder="Nombre y apellido"
                  maxLength={150}
                  disabled={enviando}
                />
              </Campo>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                htmlFor="tk-module"
                label="Módulo afectado"
                required
                hint="Dónde ocurre o dónde debería vivir lo que pides."
              >
                <Select
                  id="tk-module"
                  aria-label="Módulo afectado"
                  value={modulo}
                  onChange={(e) => setModulo(e.target.value)}
                  disabled={enviando}
                >
                  <option value="">Selecciona un módulo</option>
                  {TICKET_MODULES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Campo>

              <Campo
                htmlFor="tk-project"
                label="Proyecto (opcional)"
                hint="Solo si el requerimiento nace de un proyecto concreto."
              >
                <Select
                  id="tk-project"
                  aria-label="Proyecto relacionado"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={enviando}
                >
                  <option value="">Ninguno</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>

            <Campo
              htmlFor="tk-expected"
              label="Qué necesitas que el sistema haga"
              required
              hint="El resultado esperado, no la solución técnica. El cómo se define en arquitectura."
            >
              <Textarea
                id="tk-expected"
                rows={4}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                placeholder="Ej. Que al cargar una boleta de combustible se pueda asociar al vehículo y a la faena, y que después se pueda ver el consumo por faena en un periodo."
                disabled={enviando}
              />
            </Campo>

            <Campo
              htmlFor="tk-impact"
              label="Qué pasa hoy si esto no existe"
              required
              hint="Es el insumo de la priorización: un ticket sin impacto declarado compite mal contra los demás."
            >
              <Textarea
                id="tk-impact"
                rows={4}
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                placeholder="Ej. Hoy se lleva en una planilla aparte y no cuadra con las boletas, así que el costo por faena se estima a mano cada mes."
                disabled={enviando}
              />
            </Campo>

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                htmlFor="tk-people"
                label="Personas afectadas"
                required
                hint="Cuánta gente deja de perder tiempo si esto existe."
              >
                <Select
                  id="tk-people"
                  aria-label="Personas afectadas"
                  value={peopleAffected}
                  onChange={(e) => setPeopleAffected(e.target.value as TicketPeopleAffected)}
                  disabled={enviando}
                >
                  {(Object.keys(TICKET_PEOPLE_LABELS) as TicketPeopleAffected[]).map((k) => (
                    <option key={k} value={k}>
                      {TICKET_PEOPLE_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Campo>

              <Campo htmlFor="tk-freq" label="Frecuencia" required hint="Cada cuánto ocurre.">
                <Select
                  id="tk-freq"
                  aria-label="Frecuencia"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as TicketFrequency)}
                  disabled={enviando}
                >
                  {(Object.keys(TICKET_FREQUENCY_LABELS) as TicketFrequency[]).map((k) => (
                    <option key={k} value={k}>
                      {TICKET_FREQUENCY_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                htmlFor="tk-due"
                label="Fecha comprometida (opcional)"
                hint="Solo si hay un compromiso real con un tercero."
              >
                <Input
                  id="tk-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={enviando}
                />
              </Campo>

              <Campo
                htmlFor="tk-milestone"
                label="Hito (opcional)"
                hint="A qué hito o entrega está atado."
              >
                <Input
                  id="tk-milestone"
                  value={milestone}
                  onChange={(e) => setMilestone(e.target.value)}
                  maxLength={200}
                  disabled={enviando}
                />
              </Campo>
            </div>

            <Campo label="Adjuntos" hint="Próximamente: por ahora describe el caso en el texto.">
              <Button type="button" variant="outline" size="sm" disabled>
                Adjuntar archivo
              </Button>
            </Campo>

            <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={managerAck}
                onChange={(e) => setManagerAck(e.target.checked)}
                disabled={enviando}
              />
              <span className="text-sm text-foreground">
                Confirmo que mi jefatura respalda esta solicitud.
                <span className="block text-xs text-muted-foreground">
                  Informática ejecuta prioridades; quién decide la prioridad de tu área es tu jefatura.
                </span>
              </span>
            </label>

            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/operaciones/mis-solicitudes')}
                disabled={enviando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Enviar ticket
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
