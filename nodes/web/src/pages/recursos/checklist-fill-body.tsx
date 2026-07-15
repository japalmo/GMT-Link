/**
 * Cuerpo del formulario de ejecución de checklist. Renderiza los ítems de la
 * plantilla y decide el layout:
 *
 * - Con secciones (`template.sections`): una PÁGINA por sección (título +
 *   descripción arriba) con navegación Anterior/Siguiente e indicador de progreso
 *   (paso X de N). Los ítems sin sección caen en una página "General".
 * - Sin secciones: una sola página (comportamiento clásico), idéntica a antes.
 *
 * El botón de envío (type="submit") vive aquí, pero el `<form>` y su `onSubmit`
 * los provee el contenedor (recursos/index.tsx): así se conserva la doble vía
 * (confirmar ciclo vs inspección standalone) y el guard de doble envío.
 *
 * Los ítems SVG usan {@link SvgChecklistInput} en modo `fill`; su respuesta es el
 * JSON string del mapa de comentarios, guardado en `answers[item.id]` como
 * cualquier otro valor.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SvgChecklistInput } from './svg-checklist-input';
import type {
  ChecklistTemplateView,
  ChecklistTemplateItem,
  ChecklistSection,
} from '@/types/assets';

interface ChecklistFillBodyProps {
  template: ChecklistTemplateView;
  answers: Record<string, unknown>;
  setAnswer: (key: string, value: unknown) => void;
  submitting: boolean;
}

/** Una página del formulario: una sección (o la "General" de ítems sin sección). */
interface FillPage {
  key: string;
  title: string | null;
  description?: string;
  items: ChecklistTemplateItem[];
}

/** ¿La respuesta a un ítem cuenta como "vacía" (para la validación suave de requeridos)? */
function isItemMissing(item: ChecklistTemplateItem, answers: Record<string, unknown>): boolean {
  const raw = answers[item.id];
  if (item.type === 'BOOLEAN') return typeof raw !== 'boolean';
  return raw === undefined || raw === null || raw === '';
}

export function ChecklistFillBody({
  template,
  answers,
  setAnswer,
  submitting,
}: ChecklistFillBodyProps) {
  // Ítems TEXTO companion (referidos por el `obsItemId` de un ESTADO): no se
  // muestran sueltos, su valor se captura en el textarea de observación del ESTADO.
  const obsItemIds = useMemo(
    () =>
      new Set(
        template.items
          .map((it) => it.config?.obsItemId)
          .filter((v): v is string => Boolean(v)),
      ),
    [template.items],
  );

  const visibleItems = useMemo(
    () => template.items.filter((it) => !obsItemIds.has(it.id)),
    [template.items, obsItemIds],
  );

  const sections: ChecklistSection[] = template.sections ?? [];

  // Construye las páginas. Con secciones: una por sección (con sus ítems) +
  // "General" para los ítems sin sección o con sección desconocida. Se descartan
  // las páginas sin ítems para no mostrar pasos en blanco.
  const pages = useMemo<FillPage[]>(() => {
    if (sections.length === 0) {
      return [{ key: '__single__', title: null, items: visibleItems }];
    }
    const sectionIds = new Set(sections.map((s) => s.id));
    const result: FillPage[] = sections.map((s) => ({
      key: s.id,
      title: s.title,
      description: s.description,
      items: visibleItems.filter((it) => it.section === s.id),
    }));
    const orphans = visibleItems.filter((it) => !it.section || !sectionIds.has(it.section));
    if (orphans.length > 0) {
      result.push({ key: '__general__', title: 'General', items: orphans });
    }
    return result.filter((p) => p.items.length > 0);
  }, [sections, visibleItems]);

  const isPaginated = sections.length > 0 && pages.length > 0;
  const [pageIndex, setPageIndex] = useState(0);
  const safeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const currentPage = pages[safeIndex];
  const isLastPage = safeIndex >= pages.length - 1;

  if (visibleItems.length === 0 || pages.length === 0 || !currentPage) {
    return (
      <p className="text-center text-xs text-muted-foreground py-4">
        No hay preguntas de inspección configuradas en este checklist.
      </p>
    );
  }

  // Validación suave al avanzar de página: avisa si falta un requerido de ESTA
  // página (no bloquea el resto del flujo). Los SVG no se exigen (son opcionales
  // en la práctica: un diagrama sin observaciones es válido).
  const goNext = () => {
    const missing = currentPage.items.find(
      (it) => it.required && it.type !== 'SVG' && isItemMissing(it, answers),
    );
    if (missing) {
      toast.warning(`Completa "${missing.label}" antes de continuar.`);
      return;
    }
    setPageIndex(Math.min(safeIndex + 1, pages.length - 1));
  };

  const renderItemInput = (item: ChecklistTemplateItem) => {
    switch (item.type) {
      case 'BOOLEAN':
        return (
          <div className="flex gap-4 mt-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`ans-${item.id}`}
                required={item.required}
                checked={answers[item.id] === true}
                onChange={() => setAnswer(item.id, true)}
                className="size-4 text-primary"
              />
              <span>Sí</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={`ans-${item.id}`}
                required={item.required}
                checked={answers[item.id] === false}
                onChange={() => setAnswer(item.id, false)}
                className="size-4 text-rose-500"
              />
              <span className="text-rose-400 font-medium">No</span>
            </label>
          </div>
        );

      case 'ESTADO': {
        const chosen = answers[item.id];
        const isFail =
          typeof chosen === 'string' && (item.config?.failOptions?.includes(chosen) ?? false);
        const showObs = isFail || (item.config?.requireObs ?? false);
        const obsKey = item.config?.obsItemId ?? `${item.id}__obs`;
        return (
          <>
            <Select
              aria-label={item.label}
              required={item.required}
              value={(chosen as string | undefined) ?? ''}
              onChange={(e) => setAnswer(item.id, e.target.value)}
              className="h-8 px-2 text-xs w-full max-w-xs"
            >
              <option value="" disabled>
                Selecciona una opción
              </option>
              {(item.config?.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            {showObs && (
              <Textarea
                required={showObs}
                value={(answers[obsKey] as string | undefined) ?? ''}
                onChange={(e) => setAnswer(obsKey, e.target.value)}
                placeholder="Describe la observación o falla detectada"
                className="text-xs mt-1"
              />
            )}
          </>
        );
      }

      case 'ENTERO':
        return (
          <Input
            type="number"
            required={item.required}
            min={item.config?.min}
            max={item.config?.max}
            value={(answers[item.id] as string | number | undefined) ?? ''}
            onChange={(e) => setAnswer(item.id, e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Ingresa un valor numérico"
            className="h-8 text-xs w-full max-w-xs"
          />
        );

      case 'FECHA':
        return (
          <Input
            type="date"
            required={item.required}
            value={(answers[item.id] as string | undefined) ?? ''}
            onChange={(e) => setAnswer(item.id, e.target.value)}
            className="h-8 text-xs w-full max-w-xs"
          />
        );

      case 'SVG':
        return (
          <SvgChecklistInput
            mode="fill"
            config={item.config}
            value={answers[item.id] as string | undefined}
            onChange={(v) => setAnswer(item.id, v)}
          />
        );

      case 'TEXTO':
      default:
        return (
          <Input
            type="text"
            required={item.required}
            value={(answers[item.id] as string | undefined) ?? ''}
            onChange={(e) => setAnswer(item.id, e.target.value)}
            placeholder="Ingresa tus observaciones"
            className="h-8 text-xs w-full"
          />
        );
    }
  };

  const renderItems = (items: ChecklistTemplateItem[]) => (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1.5 text-xs">
          <Label className="font-semibold text-foreground flex gap-1">
            {item.label}
            {item.required && item.type !== 'SVG' && <span className="text-rose-500">*</span>}
          </Label>
          {renderItemInput(item)}
        </div>
      ))}
    </div>
  );

  // ---- Layout de una sola página (sin secciones): idéntico al clásico. ----
  if (!isPaginated) {
    return (
      <>
        {renderItems(currentPage.items)}
        <div className="flex justify-end mt-2">
          <Button type="submit" size="sm" loading={submitting}>
            Firmar y Enviar Inspección
          </Button>
        </div>
      </>
    );
  }

  // ---- Layout por páginas (una sección por página). ----
  return (
    <>
      <div className="flex flex-col gap-1 border-b border-border/50 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <ClipboardCheck className="size-3.5 text-primary" />
            {currentPage.title ?? 'General'}
          </p>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            Paso {safeIndex + 1} de {pages.length}
          </span>
        </div>
        {currentPage.description && (
          <p className="text-[11px] text-muted-foreground">{currentPage.description}</p>
        )}
        <div className="flex gap-1 mt-1">
          {pages.map((p, i) => (
            <span
              key={p.key}
              className={`h-1 flex-1 rounded-full ${
                i <= safeIndex ? 'bg-primary' : 'bg-border'
              }`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {renderItems(currentPage.items)}

      <div className="flex items-center justify-between gap-2 mt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPageIndex(Math.max(safeIndex - 1, 0))}
          disabled={safeIndex === 0}
        >
          <ChevronLeft className="size-3.5 mr-1" /> Anterior
        </Button>

        {isLastPage ? (
          <Button type="submit" size="sm" loading={submitting}>
            Firmar y Enviar Inspección
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={goNext}>
            Siguiente <ChevronRight className="size-3.5 ml-1" />
          </Button>
        )}
      </div>
    </>
  );
}
