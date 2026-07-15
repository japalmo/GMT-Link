/**
 * Input de checklist basado en un diagrama SVG interactivo (p. ej. carrocería de
 * un vehículo). Dos modos:
 *
 * - `mode="edit"` (admin): sube un archivo SVG, del cual se extraen los grupos
 *   `<g id>` como "partes" nombrables. Guarda en el `config` del ítem el marcado
 *   (`svg`) y las partes (`parts: {id,name}[]`).
 * - `mode="fill"` (inspector): renderiza el diagrama y hace interactivas SOLO las
 *   partes nombradas. Al pasar el cursor muestra el nombre (tooltip nativo), al
 *   hacer clic abre un modal con un comentario para esa parte, y resalta las
 *   partes con comentario. El valor es un JSON string del mapa
 *   `{ [partId]: { part, comment } }`.
 *
 * Seguridad: el SVG viene de un admin (confiable), pero igual se sanitiza al
 * parsear/renderizar se remueven elementos `<script>` y atributos `on*` (y
 * `href="javascript:"`) antes de inyectar el marcado.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Upload, MapPin, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import type { ChecklistItemConfig, ChecklistSvgPart } from '@/types/assets';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Comentario registrado sobre una parte del diagrama. */
export interface SvgCommentEntry {
  /** Nombre legible de la parte (redundante con `parts`, se guarda para el PDF/historial). */
  part: string;
  /** Texto del comentario/observación del inspector. */
  comment: string;
}

/** Mapa `partId -> comentario` que se serializa como valor del ítem SVG. */
export type SvgCommentMap = Record<string, SvgCommentEntry>;

/** Resultado de parsear un archivo SVG subido. */
export interface SvgParseResult {
  /** Marcado sanitizado (o null si el archivo no es un SVG válido). */
  svg: string | null;
  /** Partes `<g id>` detectadas (default name = `data-part` o el `id`). */
  parts: ChecklistSvgPart[];
  /** Mensaje de error/advertencia claro para el admin (o null si todo bien). */
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers puros (testeables sin DOM de React)                                */
/* -------------------------------------------------------------------------- */

/** Remueve `<script>`, atributos `on*` y `href="javascript:"` de un elemento y su árbol. */
function sanitizeSvgElement(root: Element): void {
  root.querySelectorAll('script').forEach((s) => s.remove());
  const nodes: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'xlink:href') &&
        attr.value.trim().toLowerCase().startsWith('javascript:')
      ) {
        node.removeAttribute(attr.name);
      }
    }
  }
}

/** Extrae las partes nombrables (`<g>` con `id`, sin duplicar) de un `<svg>`. */
function collectSvgParts(svgEl: Element): ChecklistSvgPart[] {
  const groups = Array.from(svgEl.querySelectorAll('g[id]'));
  const seen = new Set<string>();
  const parts: ChecklistSvgPart[] = [];
  for (const g of groups) {
    const id = g.getAttribute('id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const dataPart = g.getAttribute('data-part');
    const name = dataPart && dataPart.trim() ? dataPart.trim() : id;
    parts.push({ id, name });
  }
  return parts;
}

/**
 * Parsea el texto de un archivo SVG: valida, SANITIZA (quita scripts/on*) y
 * extrae los `<g id>` como partes. Nunca lanza: devuelve `error` con un mensaje
 * claro para SVG inválido o sin grupos con id.
 */
export function parseSvgUpload(text: string): SvgParseResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return { svg: null, parts: [], error: 'El archivo no es un SVG válido.' };
  }

  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { svg: null, parts: [], error: 'El archivo no es un SVG válido.' };
  }

  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.nodeName.toLowerCase() !== 'svg') {
    return { svg: null, parts: [], error: 'El archivo no contiene un elemento <svg>.' };
  }

  sanitizeSvgElement(svgEl);
  const parts = collectSvgParts(svgEl);
  const markup = new XMLSerializer().serializeToString(svgEl);

  if (parts.length === 0) {
    return {
      svg: markup,
      parts: [],
      error:
        'El SVG no tiene grupos con id. Cada parte interactiva debe ser un <g id="...">.',
    };
  }
  return { svg: markup, parts, error: null };
}

/** Sanitiza un marcado SVG ya guardado (defensa al renderizar en modo fill). */
export function sanitizeSvgMarkup(markup: string | null | undefined): string | null {
  if (!markup) return null;
  const result = parseSvgUpload(markup);
  return result.svg;
}

/** Parsea (tolerante) el JSON string del valor a un mapa de comentarios válido. */
export function parseCommentMap(value: string | null | undefined): SvgCommentMap {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: SvgCommentMap = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.comment !== 'string') continue;
    out[key] = {
      part: typeof entry.part === 'string' ? entry.part : key,
      comment: entry.comment,
    };
  }
  return out;
}

/** Busca el `<g>` de una parte por su `id` (fallback: atributo `data-part`). */
function findPartElement(container: HTMLElement, id: string): SVGElement | null {
  const escaped = id.replace(/["\\]/g, '\\$&');
  return (
    container.querySelector<SVGElement>(`[id="${escaped}"]`) ??
    container.querySelector<SVGElement>(`[data-part="${escaped}"]`)
  );
}

/** Garantiza un `<title>` (tooltip nativo) al inicio del `<g>` con el nombre de la parte. */
function ensurePartTitle(g: Element, name: string): void {
  let title: Element | null = null;
  for (const child of Array.from(g.children)) {
    if (child.nodeName.toLowerCase() === 'title') {
      title = child;
      break;
    }
  }
  if (!title) {
    title = document.createElementNS(SVG_NS, 'title');
    g.insertBefore(title, g.firstChild);
  }
  title.textContent = name;
}

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface EditModeProps {
  mode: 'edit';
  config: ChecklistItemConfig | undefined;
  onChange: (config: ChecklistItemConfig) => void;
}

interface FillModeProps {
  mode: 'fill';
  config: ChecklistItemConfig | undefined;
  /** Valor actual: JSON string del mapa `{ [partId]: { part, comment } }`. */
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export type SvgChecklistInputProps = EditModeProps | FillModeProps;

/* -------------------------------------------------------------------------- */
/* Componente                                                                 */
/* -------------------------------------------------------------------------- */

export function SvgChecklistInput(props: SvgChecklistInputProps) {
  if (props.mode === 'edit') return <SvgEditView {...props} />;
  return <SvgFillView {...props} />;
}

/* -------------------------------- EDIT ------------------------------------ */

function SvgEditView({ config, onChange }: EditModeProps) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parts = config?.parts ?? [];
  const markup = useMemo(() => sanitizeSvgMarkup(config?.svg), [config?.svg]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError('No se pudo leer el archivo.');
      return;
    }
    const result = parseSvgUpload(text);
    const svg = result.svg;
    if (!svg) {
      setError(result.error ?? 'El archivo no es un SVG válido.');
      return;
    }
    // Conserva los nombres ya escritos para las partes cuyo id se mantiene.
    const nextParts = result.parts.map((p) => {
      const existing = parts.find((x) => x.id === p.id);
      return existing ? { id: p.id, name: existing.name } : p;
    });
    setError(result.error);
    onChange({ ...config, svg, parts: nextParts });
  };

  const handleRenamePart = (id: string, name: string) => {
    onChange({
      ...config,
      parts: parts.map((p) => (p.id === id ? { ...p, name } : p)),
    });
  };

  const handleClear = () => {
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onChange({ ...config, svg: undefined, parts: [] });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
        <MapPin className="size-3.5 text-primary" /> Diagrama SVG interactivo
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5 mr-1.5" />
          {markup ? 'Reemplazar diagrama' : 'Subir diagrama (.svg)'}
        </Button>
        {markup && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={handleClear}
          >
            <Trash2 className="size-3.5 mr-1.5" /> Quitar
          </Button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      )}

      {markup && (
        <div className="rounded-md border border-border bg-background p-2">
          <div
            className="mx-auto max-w-full [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-64 [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      )}

      {markup && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Partes detectadas ({parts.length})
          </p>
          {parts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground border border-dashed rounded px-2 py-3 text-center">
              No se detectaron grupos con id en el diagrama.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {parts.map((part) => (
                <div key={part.id} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 max-w-[35%] truncate">
                    {part.id}
                  </span>
                  <Input
                    aria-label={`Nombre de la parte ${part.id}`}
                    value={part.name}
                    onChange={(e) => handleRenamePart(part.id, e.target.value)}
                    placeholder="Nombre visible de la parte"
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- FILL ------------------------------------ */

function SvgFillView({ config, value, onChange, disabled = false }: FillModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => config?.parts ?? [], [config?.parts]);
  const markup = useMemo(() => sanitizeSvgMarkup(config?.svg), [config?.svg]);
  const map = useMemo(() => parseCommentMap(value), [value]);

  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState('');

  const rawScope = useId();
  const scopeClass = `svgfill-${rawScope.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Interactividad: por cada parte nombrada, ubica su `<g>` en el SVG renderizado
  // y le pone cursor + tooltip + resaltado + click. Se re-ejecuta al cambiar el
  // marcado, las partes o el mapa de comentarios. El estado (map) se lee vía la
  // clase `has-comment`.
  const partsKey = useMemo(() => JSON.stringify(parts), [parts]);
  const commentedKey = useMemo(() => Object.keys(map).sort().join('|'), [map]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !markup) return;
    const cleanups: Array<() => void> = [];
    for (const part of parts) {
      const g = findPartElement(container, part.id);
      if (!g) continue;
      g.classList.add('gmt-svg-part');
      g.style.cursor = disabled ? 'default' : 'pointer';
      ensurePartTitle(g, part.name);
      g.classList.toggle('has-comment', Boolean(map[part.id]));
      if (!disabled) {
        const handler = (e: Event) => {
          e.stopPropagation();
          setActivePartId(part.id);
          setDraftComment(map[part.id]?.comment ?? '');
        };
        g.addEventListener('click', handler);
        cleanups.push(() => g.removeEventListener('click', handler));
      }
    }
    return () => cleanups.forEach((c) => c());
    // `partsKey`/`commentedKey` estabilizan las dependencias derivadas de `parts`/`map`.
  }, [markup, parts, partsKey, commentedKey, disabled, map]);

  const commentedCount = Object.keys(map).length;
  const activePart = activePartId ? parts.find((p) => p.id === activePartId) : null;

  const closeModal = () => setActivePartId(null);

  const handleSaveComment = () => {
    if (activePartId === null) return;
    const text = draftComment.trim();
    const next: SvgCommentMap = { ...map };
    if (text === '') {
      delete next[activePartId];
    } else {
      next[activePartId] = { part: activePart?.name ?? activePartId, comment: text };
    }
    onChange(JSON.stringify(next));
    closeModal();
  };

  const handleRemoveComment = () => {
    if (activePartId === null) return;
    const next: SvgCommentMap = { ...map };
    delete next[activePartId];
    onChange(JSON.stringify(next));
    closeModal();
  };

  if (!markup) {
    return (
      <p className="text-[11px] text-muted-foreground border border-dashed rounded px-2 py-3 text-center">
        Este ítem no tiene un diagrama configurado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <style>{`
        .${scopeClass} svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
        .${scopeClass} .gmt-svg-part { pointer-events: auto; transition: opacity .15s ease; }
        .${scopeClass} .gmt-svg-part:hover { opacity: .82; }
        .${scopeClass} .gmt-svg-part.has-comment,
        .${scopeClass} .gmt-svg-part.has-comment * {
          fill: #f59e0b !important;
          stroke: #b45309 !important;
          stroke-width: 1.5 !important;
        }
      `}</style>

      <div className="rounded-md border border-border bg-background p-2">
        <div
          ref={containerRef}
          className={scopeClass}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {disabled
            ? 'Diagrama de solo lectura.'
            : 'Toca una parte del diagrama para dejar una observación.'}
        </span>
        {commentedCount > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {commentedCount} {commentedCount === 1 ? 'observación' : 'observaciones'}
          </Badge>
        )}
      </div>

      <Modal open={activePartId !== null} onOpenChange={(open) => !open && closeModal()}>
        <ModalContent className="sm:max-w-md">
          <ModalHeader>
            <ModalTitle>{activePart?.name ?? 'Parte del diagrama'}</ModalTitle>
            <ModalDescription>
              Registra una observación para esta parte. Déjala vacía para quitarla.
            </ModalDescription>
          </ModalHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="svg-part-comment" className="text-xs">
              Observación
            </Label>
            <Textarea
              id="svg-part-comment"
              value={draftComment}
              onChange={(e) => setDraftComment(e.target.value)}
              placeholder="Describe el daño, rayón o detalle detectado."
              rows={4}
              className="text-sm"
            />
          </div>

          <ModalFooter>
            {activePartId && map[activePartId] && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 sm:mr-auto"
                onClick={handleRemoveComment}
              >
                <Trash2 className="size-4 mr-1.5" /> Quitar observación
              </Button>
            )}
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSaveComment}>
              Guardar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
