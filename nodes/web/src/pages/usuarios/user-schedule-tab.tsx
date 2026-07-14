import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Loader2, Moon, Sun } from 'lucide-react';
import {
  SHIFT_PATTERN_CYCLE,
  type DayNight,
  type ShiftPattern,
  type UpsertWorkScheduleInput,
  type WorkScheduleView,
} from '@gmt-platform/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, fetchUserSchedule, upsertUserSchedule } from '@/lib/api';
import { toast } from 'sonner';
import { buildSchedulePreview, SHIFT_PATTERN_LABEL } from './schedule-preview';

/** Patrones en el orden del selector. */
const PATTERN_OPTIONS: ReadonlyArray<ShiftPattern> = [
  'ADMINISTRATIVO',
  'SIETE_POR_SIETE',
  'CUATRO_POR_TRES',
  'CATORCE_POR_CATORCE',
  'PERSONALIZADO',
];

/** Estado editable de la jornada (todos como string para inputs controlados). */
interface ScheduleForm {
  shiftPattern: ShiftPattern;
  dayNight: DayNight;
  startTime: string;
  endTime: string;
  cycleStart: string; // "YYYY-MM-DD"
  workDays: string;
  restDays: string;
  notes: string;
}

const EMPTY_FORM: ScheduleForm = {
  shiftPattern: 'ADMINISTRATIVO',
  dayNight: 'DIA',
  startTime: '',
  endTime: '',
  cycleStart: '',
  workDays: '7',
  restDays: '7',
  notes: '',
};

/** Extrae "YYYY-MM-DD" de un ISO (para el input date), sin drift de zona horaria. */
function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m?.[1] ?? '';
}

function seed(schedule: WorkScheduleView | null): ScheduleForm {
  if (!schedule) return EMPTY_FORM;
  return {
    shiftPattern: schedule.shiftPattern,
    dayNight: schedule.dayNight,
    startTime: schedule.startTime ?? '',
    endTime: schedule.endTime ?? '',
    cycleStart: isoToDateInput(schedule.cycleStart),
    workDays: schedule.workDays != null ? String(schedule.workDays) : '7',
    restDays: schedule.restDays != null ? String(schedule.restDays) : '7',
    notes: schedule.notes ?? '',
  };
}

/** Vista de jornada equivalente al formulario, para el preview en vivo. */
function formToScheduleView(form: ScheduleForm): WorkScheduleView {
  const preset = SHIFT_PATTERN_CYCLE[form.shiftPattern];
  let workDays: number | null = null;
  let restDays: number | null = null;
  if (form.shiftPattern === 'ADMINISTRATIVO') {
    workDays = null;
    restDays = null;
  } else if (preset) {
    workDays = preset.workDays;
    restDays = preset.restDays;
  } else {
    workDays = Number(form.workDays) || null;
    restDays = Number(form.restDays) || null;
  }
  return {
    shiftPattern: form.shiftPattern,
    workDays,
    restDays,
    cycleStart: form.shiftPattern === 'ADMINISTRATIVO' ? null : form.cycleStart || null,
    dayNight: form.dayNight,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
    notes: form.notes || null,
    updatedAt: '',
  };
}

/**
 * Pestaña Horario del detalle del trabajador — jornada / turnos (admin). Trae la
 * jornada (`GET /users/:id/schedule`), permite configurarla (patrón de turno,
 * turno día/noche, jornada diaria, inicio de ciclo, notas) y la guarda con
 * `PUT /users/:id/schedule`. Muestra un preview de los próximos 14 días marcando
 * faena / descanso según el ciclo.
 */
export function UserScheduleTab({ userId }: { userId: string }): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    fetchUserSchedule(userId)
      .then((data) => {
        if (!alive) return;
        setForm(seed(data));
        setUpdatedAt(data?.updatedAt ?? null);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(errorToMessage(err, 'No se pudo cargar la jornada.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => load(), [load]);

  function update<K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isAdministrative = form.shiftPattern === 'ADMINISTRATIVO';
  const isCustom = form.shiftPattern === 'PERSONALIZADO';

  const preview = useMemo(
    () => buildSchedulePreview(formToScheduleView(form), new Date(), 14),
    [form],
  );

  function validate(): string | null {
    if (!isAdministrative && !form.cycleStart) {
      return 'Define la fecha de inicio de ciclo para este turno.';
    }
    if (isCustom) {
      const w = Number(form.workDays);
      const r = Number(form.restDays);
      if (!Number.isInteger(w) || !Number.isInteger(r) || w < 1 || r < 1) {
        return 'El turno personalizado requiere días de faena y de descanso (al menos 1 de cada uno).';
      }
    }
    return null;
  }

  async function handleSave(): Promise<void> {
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const input: UpsertWorkScheduleInput = {
        shiftPattern: form.shiftPattern,
        dayNight: form.dayNight,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        notes: form.notes.trim() || null,
        ...(isAdministrative
          ? {}
          : {
              cycleStart: form.cycleStart || null,
              ...(isCustom ? { workDays: Number(form.workDays), restDays: Number(form.restDays) } : {}),
            }),
      };
      const saved = await upsertUserSchedule(userId, input);
      setForm(seed(saved));
      setUpdatedAt(saved.updatedAt);
      toast.success('Jornada guardada.');
    } catch (err) {
      setFormError(errorToMessage(err, 'No se pudo guardar la jornada.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState rows={4} label="Cargando jornada…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${baseId}-pattern`} label="Patrón de turno">
          <Select
            id={`${baseId}-pattern`}
            aria-label="Patrón de turno"
            value={form.shiftPattern}
            onChange={(e) => update('shiftPattern', e.target.value as ShiftPattern)}
          >
            {PATTERN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {SHIFT_PATTERN_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>

        <Field id={`${baseId}-daynight`} label="Turno">
          <Select
            id={`${baseId}-daynight`}
            aria-label="Turno día o noche"
            value={form.dayNight}
            onChange={(e) => update('dayNight', e.target.value as DayNight)}
          >
            <option value="DIA">Día</option>
            <option value="NOCHE">Noche</option>
          </Select>
        </Field>

        <Field id={`${baseId}-start`} label="Hora de inicio">
          <Input
            id={`${baseId}-start`}
            type="time"
            value={form.startTime}
            onChange={(e) => update('startTime', e.target.value)}
          />
        </Field>

        <Field id={`${baseId}-end`} label="Hora de término">
          <Input
            id={`${baseId}-end`}
            type="time"
            value={form.endTime}
            onChange={(e) => update('endTime', e.target.value)}
          />
        </Field>

        {!isAdministrative && (
          <Field id={`${baseId}-cyclestart`} label="Inicio de ciclo (día 1 en faena)">
            <Input
              id={`${baseId}-cyclestart`}
              type="date"
              value={form.cycleStart}
              onChange={(e) => update('cycleStart', e.target.value)}
            />
          </Field>
        )}

        {isCustom && (
          <>
            <Field id={`${baseId}-workdays`} label="Días de faena">
              <Input
                id={`${baseId}-workdays`}
                type="number"
                min={1}
                max={60}
                value={form.workDays}
                onChange={(e) => update('workDays', e.target.value)}
              />
            </Field>
            <Field id={`${baseId}-restdays`} label="Días de descanso">
              <Input
                id={`${baseId}-restdays`}
                type="number"
                min={1}
                max={60}
                value={form.restDays}
                onChange={(e) => update('restDays', e.target.value)}
              />
            </Field>
          </>
        )}
      </div>

      <Field id={`${baseId}-notes`} label="Notas">
        <Textarea
          id={`${baseId}-notes`}
          rows={2}
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Detalles de la jornada, excepciones, etc."
        />
      </Field>

      {/* Preview de los próximos 14 días. */}
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          Próximos 14 días
          {form.dayNight === 'NOCHE' ? (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Moon className="size-3.5" aria-hidden /> turno noche
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Sun className="size-3.5" aria-hidden /> turno día
            </span>
          )}
        </h4>
        {preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Define la fecha de inicio de ciclo para ver los días de faena y descanso.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {preview.map((day) => (
              <div
                key={day.date.toISOString()}
                className={
                  day.working
                    ? 'flex min-w-14 flex-col items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-center'
                    : 'flex min-w-14 flex-col items-center rounded-md border border-border bg-muted/40 px-2 py-1.5 text-center'
                }
              >
                <span className="text-[11px] capitalize text-muted-foreground">
                  {day.date.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' })}
                </span>
                <span
                  className={
                    day.working
                      ? 'text-[11px] font-semibold text-primary'
                      : 'text-[11px] font-medium text-muted-foreground'
                  }
                >
                  {day.working ? 'Faena' : 'Descanso'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {formError && (
        <Alert variant="destructive" live>
          {formError}
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {updatedAt
            ? `Última actualización: ${new Date(updatedAt).toLocaleDateString('es-CL')}`
            : 'Jornada sin configurar'}
        </span>
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Guardar jornada
        </Button>
      </div>
    </div>
  );
}

/** Campo etiquetado (label + control). */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
