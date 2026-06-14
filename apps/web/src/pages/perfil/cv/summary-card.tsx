import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/**
 * Tarjeta editable del resumen profesional del CV. Texto libre; se guarda vía
 * `onSave`. Muestra feedback de éxito/error y se re-sincroniza si el valor
 * cambia desde fuera (refetch).
 */
export function SummaryCard({
  summary,
  onSave,
}: {
  summary: string | null;
  onSave: (summary: string) => Promise<void>;
}): ReactNode {
  const [value, setValue] = useState(summary ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setValue(summary ?? '');
  }, [summary]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await onSave(value.trim());
      setSuccess(true);
    } catch (err) {
      setError(toMessage(err, 'No se pudo guardar el resumen.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumen profesional</CardTitle>
        <CardDescription>
          Una breve descripción de tu trayectoria y especialidades.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cv-summary">Resumen</Label>
            <textarea
              id="cv-summary"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSuccess(false);
                setError(null);
              }}
              disabled={saving}
              rows={4}
              placeholder="Ej. Topógrafo con 8 años de experiencia en proyectos mineros…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {success && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              <Check className="size-4 shrink-0" aria-hidden />
              Tu resumen se guardó correctamente.
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Guardar resumen
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
