import { type ReactNode, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FreshFileLink } from '@/components/documents/fresh-file-link';
import { getAssetDocumentFileUrl } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AssetDocumentView, DocumentStatus } from '@/types/assets';

/**
 * Documentación del vehículo.
 *
 * La pantalla parte de los documentos que un vehículo DEBE tener y muestra
 * cuáles faltan, en vez de partir de una lista vacía y un formulario. Antes
 * había que escribir el nombre, elegir una categoría genérica, poner la fecha y
 * recién ahí adjuntar: cuatro decisiones para subir un permiso de circulación,
 * y ninguna garantizaba que el documento quedara nombrado igual que el del
 * vehículo de al lado. Ahora el nombre y el tipo salen del casillero y solo se
 * piden las dos cosas que el sistema no puede saber: el archivo y hasta cuándo
 * vale.
 */

/** Casilleros obligatorios de un vehículo, en el orden en que se piden en ruta. */
const CASILLEROS = [
  {
    tipo: 'PERMISO_CIRCULACION',
    nombre: 'Permiso de circulación',
    ayuda: 'Vence el 31 de marzo de cada año.',
    venceSiempre: true,
  },
  {
    tipo: 'REVISION_TECNICA',
    nombre: 'Revisión técnica',
    ayuda: 'Incluye el análisis de gases.',
    venceSiempre: true,
  },
  {
    tipo: 'SOAP',
    nombre: 'SOAP',
    ayuda: 'Seguro obligatorio de accidentes personales.',
    venceSiempre: true,
  },
  {
    tipo: 'CERT_BARRA_ANTIVUELCO',
    nombre: 'Certificación de barra antivuelco',
    ayuda: 'Exigida para entrar a faena.',
    venceSiempre: true,
  },
  {
    tipo: 'CERT_CUNAS',
    nombre: 'Certificación de cuñas',
    ayuda: 'Cuñas de seguridad del vehículo.',
    venceSiempre: true,
  },
] as const;

type Casillero = (typeof CASILLEROS)[number];

const DIAS_POR_VENCER = 30;

type EstadoCasillero = 'falta' | 'en_revision' | 'rechazado' | 'vigente' | 'por_vencer' | 'vencido';

const PRESENTACION: Record<
  EstadoCasillero,
  { etiqueta: string; clase: string; icono: typeof CircleCheck }
> = {
  falta: {
    etiqueta: 'Falta',
    clase: 'border-dashed text-muted-foreground',
    icono: CircleDashed,
  },
  en_revision: {
    etiqueta: 'En revisión',
    clase: 'border-sky-500/40 bg-sky-500/5',
    icono: Clock,
  },
  rechazado: {
    etiqueta: 'Rechazado',
    clase: 'border-destructive/40 bg-destructive/5',
    icono: CircleAlert,
  },
  vigente: {
    etiqueta: 'Vigente',
    clase: 'border-emerald-500/40 bg-emerald-500/5',
    icono: CircleCheck,
  },
  por_vencer: {
    etiqueta: 'Por vencer',
    clase: 'border-amber-500/50 bg-amber-500/5',
    icono: Clock,
  },
  vencido: {
    etiqueta: 'Vencido',
    clase: 'border-destructive/40 bg-destructive/5',
    icono: CircleAlert,
  },
};

function estadoDe(doc: AssetDocumentView | undefined): EstadoCasillero {
  if (!doc) return 'falta';
  if (doc.status === 'RECHAZADO') return 'rechazado';
  if (doc.status !== 'APROBADO') return 'en_revision';
  if (!doc.expirationDate) return 'vigente';
  const faltan = new Date(doc.expirationDate).getTime() - Date.now();
  if (faltan < 0) return 'vencido';
  return faltan < DIAS_POR_VENCER * 86_400_000 ? 'por_vencer' : 'vigente';
}

/**
 * Documento que ocupa un casillero: el más reciente de ese tipo.
 *
 * Se toma el más nuevo y no el primer aprobado a propósito: cuando alguien
 * renueva el permiso de circulación, lo que importa es el que acaba de subir,
 * incluso mientras espera revisión. Mostrar el viejo daría la impresión de que
 * la renovación no se cargó.
 */
function documentoDe(
  docs: ReadonlyArray<AssetDocumentView>,
  tipo: string,
): AssetDocumentView | undefined {
  return docs
    .filter((d) => d.type === tipo)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export interface DocumentacionVehiculoProps {
  assetId: string;
  docs: ReadonlyArray<AssetDocumentView>;
  /** Si el usuario puede aprobar o rechazar (admin). */
  puedeRevisar: boolean;
  onSubir: (nombre: string, tipo: string, archivo: File, vencimiento?: string) => Promise<void>;
  onRevisar: (docId: string, estado: Extract<DocumentStatus, 'APROBADO' | 'RECHAZADO'>) => void;
  /** Mostrar u ocultar el documento en la ficha pública. */
  onToggleFiche: (docId: string, visible: boolean) => void;
}

/** Interruptor "visible en ficha": un botón con estado claro, sin componente Switch. */
function ToggleFicha({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onToggle}
      aria-pressed={visible}
      title={visible ? 'Se muestra en la ficha pública' : 'Oculto en la ficha pública'}
      className={visible ? 'text-primary' : 'text-muted-foreground'}
    >
      {visible ? <Eye className="mr-1.5 size-3.5" /> : <EyeOff className="mr-1.5 size-3.5" />}
      {visible ? 'En ficha' : 'Oculto'}
    </Button>
  );
}

export function DocumentacionVehiculo({
  assetId,
  docs,
  puedeRevisar,
  onSubir,
  onRevisar,
  onToggleFiche,
}: DocumentacionVehiculoProps): ReactNode {
  const tiposDeCasillero = useMemo(() => new Set(CASILLEROS.map((c) => c.tipo as string)), []);
  const otros = docs.filter((d) => !tiposDeCasillero.has(d.type));

  const faltantes = CASILLEROS.filter((c) => !documentoDe(docs, c.tipo)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-4 text-primary" /> Documentación
        </CardTitle>
        <CardDescription>
          {faltantes === 0
            ? 'Los cinco documentos obligatorios están cargados.'
            : faltantes === 1
              ? `Falta 1 de ${CASILLEROS.length} documentos obligatorios.`
              : `Faltan ${faltantes} de ${CASILLEROS.length} documentos obligatorios.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {CASILLEROS.map((c) => (
          <CasilleroDocumento
            key={c.tipo}
            assetId={assetId}
            casillero={c}
            doc={documentoDe(docs, c.tipo)}
            puedeRevisar={puedeRevisar}
            onSubir={onSubir}
            onRevisar={onRevisar}
            onToggleFiche={onToggleFiche}
          />
        ))}

        <div className="pt-2">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Otros documentos</p>
          {otros.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay otros documentos cargados en este vehículo.
            </p>
          ) : (
            <div className="space-y-2">
              {otros.map((d) => (
                <OtroDocumento
                  key={d.id}
                  assetId={assetId}
                  doc={d}
                  puedeRevisar={puedeRevisar}
                  onRevisar={onRevisar}
                  onToggleFiche={onToggleFiche}
                />
              ))}
            </div>
          )}
          <SubirOtro onSubir={onSubir} />
        </div>
      </CardContent>
    </Card>
  );
}

function CasilleroDocumento({
  assetId,
  casillero,
  doc,
  puedeRevisar,
  onSubir,
  onRevisar,
  onToggleFiche,
}: {
  assetId: string;
  casillero: Casillero;
  doc: AssetDocumentView | undefined;
  puedeRevisar: boolean;
  onSubir: DocumentacionVehiculoProps['onSubir'];
  onRevisar: DocumentacionVehiculoProps['onRevisar'];
  onToggleFiche: DocumentacionVehiculoProps['onToggleFiche'];
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const estado = estadoDe(doc);
  const p = PRESENTACION[estado];
  const Icono = p.icono;

  return (
    <div className={`rounded-lg border p-3 ${p.clase}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icono className="size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{casillero.nombre}</p>
            <p className="text-xs text-muted-foreground">
              {doc?.expirationDate
                ? `Vence el ${formatDate(doc.expirationDate)}`
                : doc
                  ? 'Sin fecha de vencimiento registrada'
                  : casillero.ayuda}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {p.etiqueta}
          </Badge>
          {doc ? (
            <FreshFileLink
              getUrl={() => getAssetDocumentFileUrl(assetId, doc.id)}
              className="text-xs font-medium text-primary hover:underline"
              aria-label={`Ver ${casillero.nombre}`}
            >
              Ver
            </FreshFileLink>
          ) : null}
          {doc ? (
            <ToggleFicha
              visible={doc.visibleInFiche}
              onToggle={() => onToggleFiche(doc.id, !doc.visibleInFiche)}
            />
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setAbierto((v) => !v)}>
            <Upload className="mr-1.5 size-3.5" />
            {doc ? 'Reemplazar' : 'Cargar'}
          </Button>
        </div>
      </div>

      {doc && doc.status === 'EN_REVISION' && puedeRevisar ? (
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            className="bg-emerald-500 text-white hover:bg-emerald-600"
            onClick={() => onRevisar(doc.id, 'APROBADO')}
          >
            Aprobar
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onRevisar(doc.id, 'RECHAZADO')}>
            Rechazar
          </Button>
        </div>
      ) : null}

      {abierto ? (
        <FormularioCarga
          nombre={casillero.nombre}
          tipo={casillero.tipo}
          pedirVencimiento={casillero.venceSiempre}
          onSubir={onSubir}
          onListo={() => setAbierto(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Las dos únicas preguntas de la carga: el archivo y hasta cuándo vale.
 * El nombre y el tipo los pone el casillero.
 */
function FormularioCarga({
  nombre,
  tipo,
  pedirVencimiento,
  onSubir,
  onListo,
}: {
  nombre: string;
  tipo: string;
  pedirVencimiento: boolean;
  onSubir: DocumentacionVehiculoProps['onSubir'];
  onListo: () => void;
}): ReactNode {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vence, setVence] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idArchivo = useRef(`archivo-${tipo}-${Math.random().toString(36).slice(2, 8)}`).current;

  const enviar = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!archivo) {
      setError('Elige el archivo.');
      return;
    }
    if (pedirVencimiento && !vence) {
      setError('Indica hasta cuándo tiene validez.');
      return;
    }
    setSubiendo(true);
    setError(null);
    try {
      await onSubir(nombre, tipo, archivo, vence || undefined);
      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el documento.');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mt-3 space-y-2 rounded-md border bg-background/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={idArchivo} className="text-xs">
            Archivo (PDF o imagen)
          </Label>
          <input
            id={idArchivo}
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idArchivo}-vence`} className="text-xs">
            Vigente hasta {pedirVencimiento ? '' : '(opcional)'}
          </Label>
          <Input
            id={`${idArchivo}-vence`}
            type="date"
            value={vence}
            onChange={(e) => setVence(e.target.value)}
            className="h-8 bg-transparent text-xs"
          />
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onListo} disabled={subiendo}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={subiendo}>
          {subiendo ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
          {subiendo ? 'Subiendo…' : 'Subir'}
        </Button>
      </div>
    </form>
  );
}

function OtroDocumento({
  assetId,
  doc,
  puedeRevisar,
  onRevisar,
  onToggleFiche,
}: {
  assetId: string;
  doc: AssetDocumentView;
  puedeRevisar: boolean;
  onRevisar: DocumentacionVehiculoProps['onRevisar'];
  onToggleFiche: DocumentacionVehiculoProps['onToggleFiche'];
}): ReactNode {
  const estado = estadoDe(doc);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card/30 p-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{doc.name}</p>
        <p className="text-xs text-muted-foreground">
          {doc.expirationDate ? `Vence el ${formatDate(doc.expirationDate)}` : 'Sin vencimiento'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          {PRESENTACION[estado].etiqueta}
        </Badge>
        <FreshFileLink
          getUrl={() => getAssetDocumentFileUrl(assetId, doc.id)}
          className="text-xs font-medium text-primary hover:underline"
          aria-label={`Ver ${doc.name}`}
        >
          Ver
        </FreshFileLink>
        <ToggleFicha
          visible={doc.visibleInFiche}
          onToggle={() => onToggleFiche(doc.id, !doc.visibleInFiche)}
        />
        {doc.status === 'EN_REVISION' && puedeRevisar ? (
          <>
            <Button
              size="sm"
              className="bg-emerald-500 text-white hover:bg-emerald-600"
              onClick={() => onRevisar(doc.id, 'APROBADO')}
            >
              Aprobar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onRevisar(doc.id, 'RECHAZADO')}>
              Rechazar
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Carga de un documento que no cae en ninguno de los cinco casilleros. */
function SubirOtro({ onSubir }: { onSubir: DocumentacionVehiculoProps['onSubir'] }): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');

  if (!abierto) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={() => setAbierto(true)}
      >
        <Upload className="mr-1.5 size-3.5" /> Subir otro documento
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="otro-doc-nombre" className="text-xs">
          ¿Qué documento es?
        </Label>
        <Input
          id="otro-doc-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. Póliza de seguro adicional"
          className="h-8 text-xs"
        />
      </div>
      {nombre.trim() ? (
        <FormularioCarga
          nombre={nombre.trim()}
          tipo="OTRO"
          pedirVencimiento={false}
          onSubir={onSubir}
          onListo={() => {
            setNombre('');
            setAbierto(false);
          }}
        />
      ) : (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
