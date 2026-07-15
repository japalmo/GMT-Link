import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Loader2, Moon, Sun } from 'lucide-react';
import {
  SHIFT_PATTERN_CYCLE,
  type DayNight,
  type ShiftPattern,
  type UpsertWorkScheduleInput,
  type WeeklyHoursEntry,
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

/** Días del editor semanal (índice 0 = lunes .. 6 = domingo, convención ISO - 1). */
const WEEKDAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

/** Horas por defecto al activar un día del editor semanal. */
const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';

/** Una fila del editor semanal: si se trabaja ese día y con qué horario. */
interface WeeklyDayForm {
  enabled: boolean;
  start: string;
  end: string;
}

/** Estado editable de la jornada (todos como string para inputs controlados). */
interface ScheduleForm {
  shiftPattern: ShiftPattern;
  dayNight: DayNight;
  startTime: string;
  endTime: string;
  cycleStart: string; // "YYYY-MM-DD"
  workDays: string;
  restDays: string;
  /** Editor semanal (solo ADMINISTRATIVO): 7 filas fijas, lunes a domingo. */
  weekly: WeeklyDayForm[];
  notes: string;
}

/** Editor semanal por defecto: lunes a viernes activos, 08:00 a 18:00. */
function defaultWeekly(): WeeklyDayForm[] {
  return WEEKDAY_NAMES.map((_, index) => ({
    enabled: index < 5,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
}

function emptyForm(): ScheduleForm {
  return {
    shiftPattern: 'ADMINISTRATIVO',
    dayNight: 'DIA',
    startTime: '',
    endTime: '',
    cycleStart: '',
    workDays: '7',
    restDays: '7',
    weekly: defaultWeekly(),
    notes: '',
  };
}

/** Extrae "YYYY-MM-DD" de un ISO (para el input date), sin drift de zona horaria. */
function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m?.[1] ?? '';
}

/**
 * Editor semanal desde la vista guardada: `weeklyHours` si existe; una fila
 * ADMINISTRATIVO legacy (sin `weeklyHours`) se interpreta como lunes a viernes
 * con la jornada única (o las horas por defecto si no estaba definida).
 */
function seedWeekly(schedule: WorkScheduleView): WeeklyDayForm[] {
  const saved = schedule.weeklyHours;
  if (saved !== null && saved.length > 0) {
    return WEEKDAY_NAMES.map((_, index) => {
      const entry = saved.find((e) => e.weekday === index + 1);
      return entry
        ? { enabled: true, start: entry.start, end: entry.end }
        : { enabled: false, start: DEFAULT_START, end: DEFAULT_END };
    });
  }
  return WEEKDAY_NAMES.map((_, index) => ({
    enabled: index < 5,
    start: schedule.startTime ?? DEFAULT_START,
    end: schedule.endTime ?? DEFAULT_END,
  }));
}

function seed(schedule: WorkScheduleView | null): ScheduleForm {
  if (!schedule) return emptyForm();
  return {
    shiftPattern: schedule.shiftPattern,
    dayNight: schedule.dayNight,
    startTime: schedule.startTime ?? '',
    endTime: schedule.endTime ?? '',
    cycleStart: isoToDateInput(schedule.cycleStart),
    workDays: schedule.workDays != null ? String(schedule.workDays) : '7',
    restDays: schedule.restDays != null ? String(schedule.restDays) : '7',
    weekly: seedWeekly(schedule),
    notes: schedule.notes ?? '',
  };
}

/** Entradas `weeklyHours` desde el editor semanal (solo los días activos). */
function weeklyFromForm(weekly: WeeklyDayForm[]): WeeklyHoursEntry[] {
  return weekly
    .map((day, index) => ({ day, weekday: index + 1 }))
    .filter(({ day }) => day.enabled)
    .map(({ day, weekday }) => ({ weekday, start: day.start, end: day.end }));
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
  const isAdministrative = form.shiftPattern === 'ADMINISTRATIVO';
  return {
    shiftPattern: form.shiftPattern,
    workDays,
    restDays,
    cycleStart: isAdministrative ? null : form.cycleStart || null,
    dayNight: form.dayNight,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
    weeklyHours: isAdministrative ? weeklyFromForm(form.weekly) : null,
    notes: form.notes || null,
    updatedAt: '',
  };
}

/**
 * Pestaña Horario del detalle del trabajador — jornada / turnos (admin). Trae la
 * jornada (`GET /users/:id/schedule`), permite configurarla (patrón de turno,
 * turno día/noche, horario semanal por día en ADMINISTRATIVO o jornada en faena
 * en los cíclicos, inicio de ciclo, notas) y la guarda con
 * `PUT /users/:id/schedule`. Muestra un preview de los próximos 14 días marcando
 * faena / descanso y el horario de cada día trabajado.
 */
export function UserScheduleTab({ userId }: { userId: string }): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<ScheduleForm>(emptyForm);
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

  /** Actualiza una fila del editor semanal (inmutable). */
  function updateWeekly(index: number, patch: Partial<WeeklyDayForm>): void {
    setForm((prev) => ({
      ...prev,
      weekly: prev.weekly.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    }));
  }

  /** Copia las horas del lunes a todos los días activos del editor semanal. */
  function applyMondayToActive(): void {
    setForm((prev) => {
      const monday = prev.weekly[0];
      if (!monday) return prev;
      return {
        ...prev,
        weekly: prev.weekly.map((day) =>
          day.enabled ? { ...day, start: monday.start, end: monday.end } : day,
        ),
      };
    });
  }

  const isAdministrative = form.shiftPattern === 'ADMINISTRATIVO';
  const isCustom = form.shiftPattern === 'PERSONALIZADO';

  const preview = useMemo(
    () => buildSchedulePreview(formToScheduleView(form), new Date(), 14),
    [form],
  );

  function validate(): string | null {
    // Turno NOCHE: la jornada puede cruzar medianoche (p. ej. 20:00 a 08:00);
    // solo se rechaza que inicio y término sean iguales (espejo del service).
    const isNight = form.dayNight === 'NOCHE';
    if (isAdministrative) {
      // Espejo de la validación del service: al menos 1 día, horas completas y
      // término posterior al inicio (o distinto, en turno noche) por día activo.
      if (!form.weekly.some((day) => day.enabled)) {
        return 'La jornada administrativa requiere al menos un día trabajado en la semana.';
      }
      for (const [index, name] of WEEKDAY_NAMES.entries()) {
        const day = form.weekly[index];
        if (!day?.enabled) continue;
        if (!day.start || !day.end) {
          return `Completa las horas del día ${name.toLowerCase()} o desactívalo.`;
        }
        if (isNight ? day.end === day.start : day.end <= day.start) {
          return isNight
            ? `La hora de término del día ${name.toLowerCase()} no puede ser igual a la de inicio.`
            : `La hora de término del día ${name.toLowerCase()} debe ser posterior a la de inicio.`;
        }
      }
      return null;
    }
    if (!form.cycleStart) {
      return 'Define la fecha de inicio de ciclo para este turno.';
    }
    if (form.startTime && form.endTime) {
      if (isNight ? form.endTime === form.startTime : form.endTime <= form.startTime) {
        return isNight
          ? 'La hora de término no puede ser igual a la de inicio.'
          : 'La hora de término debe ser posterior a la hora de inicio.';
      }
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
      const input: UpsertWorkScheduleInput = isAdministrative
        ? {
            shiftPattern: form.shiftPattern,
            dayNight: form.dayNight,
            weeklyHours: weeklyFromForm(form.weekly),
            notes: form.notes.trim() || null,
          }
        : {
            shiftPattern: form.shiftPattern,
            dayNight: form.dayNight,
            startTime: form.startTime || null,
            endTime: form.endTime || null,
            cycleStart: form.cycleStart || null,
            ...(isCustom
              ? { workDays: Number(form.workDays), restDays: Number(form.restDays) }
              : {}),
            notes: form.notes.trim() || null,
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

        {!isAdministrative && (
          <>
            <Field id={`${baseId}-start`} label="Jornada en faena">
              <div className="flex items-center gap-2">
                <Input
                  id={`${baseId}-start`}
                  type="time"
                  aria-label="Hora de inicio de la jornada en faena"
                  value={form.startTime}
                  onChange={(e) => update('startTime', e.target.value)}
                />
                <span className="text-sm text-muted-foreground">a</span>
                <Input
                  type="time"
                  aria-label="Hora de término de la jornada en faena"
                  value={form.endTime}
                  onChange={(e) => update('endTime', e.target.value)}
                />
              </div>
            </Field>

            <Field id={`${baseId}-cyclestart`} label="Inicio de ciclo (día 1 en faena)">
              <Input
                id={`${baseId}-cyclestart`}
                type="date"
                value={form.cycleStart}
                onChange={(e) => update('cycleStart', e.target.value)}
              />
            </Field>
          </>
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

      {/* Editor semanal: horario por día de la semana (solo ADMINISTRATIVO). */}
      {isAdministrative && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Horario semanal</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyMondayToActive}
              disabled={!form.weekly[0]?.enabled}
              title={
                !form.weekly[0]?.enabled ? 'Activa el lunes para copiar su horario' : undefined
              }
            >
              Aplicar lunes a todos los días activos
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {WEEKDAY_NAMES.map((name, index) => {
              const day = form.weekly[index] ?? {
                enabled: false,
                start: DEFAULT_START,
                end: DEFAULT_END,
              };
              return (
                <div key={name} className="flex flex-wrap items-center gap-2">
                  <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={day.enabled}
                      onChange={(e) => updateWeekly(index, { enabled: e.target.checked })}
                      aria-label={`Trabaja el día ${name.toLowerCase()}`}
                    />
                    {name}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      className="w-28"
                      aria-label={`Hora de inicio del día ${name.toLowerCase()}`}
                      value={day.start}
                      disabled={!day.enabled}
                      onChange={(e) => updateWeekly(index, { start: e.target.value })}
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <Input
                      type="time"
                      className="w-28"
                      aria-label={`Hora de término del día ${name.toLowerCase()}`}
                      value={day.end}
                      disabled={!day.enabled}
                      onChange={(e) => updateWeekly(index, { end: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
                    ? 'flex min-w-16 flex-col items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-1.5 text-center'
                    : 'flex min-w-16 flex-col items-center rounded-md border border-border bg-muted/40 px-2 py-1.5 text-center'
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
                {day.hours && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {day.hours}
                  </span>
                )}
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
