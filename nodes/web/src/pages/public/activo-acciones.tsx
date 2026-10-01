import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  ClipboardCheck,
  Fuel,
  LogIn,
  PlayCircle,
  StopCircle,
  Timer,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/auth-context';
import {
  ApiError,
  endPublicAssetUse,
  registerPublicAssetUse,
  resolveAssetByToken,
} from '@/lib/api';
import type { AssetPublicView, AssetStatus } from '@/types/assets';

/** Estados en que el activo no se puede poner en uso (mismo criterio que el backend). */
const NO_OPERATIVOS: AssetStatus[] = ['MANTENIMIENTO', 'BAJA', 'DEFECTUOSO', 'NO_DISPONIBLE'];

/** Largo máximo del comentario (el backend lo valida igual). */
const MAX_COMENTARIO = 500;

/** Qué panel está abierto bajo los botones. Uno a la vez. */
type Panel = null | 'registrar' | 'terminar';

function mensajeDeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError || e instanceof Error) return e.message || fallback;
  return fallback;
}

/** Hora local corta (10:30) del inicio del uso. */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function avisarProximamente(que: string): void {
  toast.info(`${que} estará disponible próximamente.`);
}

/**
 * Acciones de la ficha pública: Llenar checklist, Registrar uso y Gestión de
 * combustible.
 *
 * - Equipos: "Registrar uso" es real. Con sesión lleva al flujo normal de la app
 *   (reclamar + checklist + cronómetro). Sin sesión abre un formulario corto de
 *   nombre + comentario; el uso queda a ese nombre, marcado como no verificado,
 *   y se termina desde esta misma ficha.
 * - Maquinaria: los mismos botones, por ahora solo visuales ("próximamente").
 * - Combustible: solo visual en ambos tipos.
 */
export function AccionesActivo({
  asset,
  token,
  onAssetChange,
}: {
  asset: AssetPublicView;
  token: string;
  onAssetChange: (asset: AssetPublicView) => void;
}): ReactNode {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [panel, setPanel] = useState<Panel>(null);
  const [nombre, setNombre] = useState('');
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esEquipo = asset.type === 'EQUIPO';
  const esMaquinaria = asset.type === 'MAQUINARIA';
  const muestraUso = asset.canRegisterUse || esMaquinaria;
  const muestraCombustible = esEquipo || esMaquinaria;

  const enUso = asset.activeUse;
  const noOperativo = NO_OPERATIVOS.includes(asset.status);

  function abrir(p: Panel): void {
    setPanel((actual) => (actual === p ? null : p));
    setError(null);
    setComentario('');
  }

  /** Con sesión: resuelve el token al activo y entra al flujo normal de la app. */
  async function registrarConSesion(): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      const { id } = await resolveAssetByToken(token);
      navigate(`/recursos?asset=${encodeURIComponent(id)}&accion=reportar-uso`);
    } catch (e: unknown) {
      setError(mensajeDeError(e, 'No pudimos abrir el registro de uso. Vuelve a intentarlo.'));
    } finally {
      setEnviando(false);
    }
  }

  function onRegistrar(): void {
    if (!asset.canRegisterUse) {
      avisarProximamente('Registrar uso de maquinaria');
      return;
    }
    if (user) {
      void registrarConSesion();
      return;
    }
    abrir('registrar');
  }

  async function enviarRegistro(e: FormEvent): Promise<void> {
    e.preventDefault();
    const declaredName = nombre.trim();
    if (!declaredName) {
      setError('Necesitamos tu nombre para el registro.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await registerPublicAssetUse(token, {
        declaredName,
        comment: comentario.trim() || undefined,
      });
      onAssetChange(actualizado);
      setPanel(null);
      setComentario('');
      toast.success(
        'Uso registrado. Cuando termines, vuelve a escanear el QR y toca "Terminar uso".',
      );
    } catch (err: unknown) {
      setError(mensajeDeError(err, 'No se pudo registrar el uso. Vuelve a intentarlo.'));
    } finally {
      setEnviando(false);
    }
  }

  async function enviarTermino(e: FormEvent): Promise<void> {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const actualizado = await endPublicAssetUse(token, {
        comment: comentario.trim() || undefined,
      });
      onAssetChange(actualizado);
      setPanel(null);
      setComentario('');
      toast.success('Uso terminado. El equipo quedó disponible.');
    } catch (err: unknown) {
      setError(mensajeDeError(err, 'No se pudo terminar el uso. Vuelve a intentarlo.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Acción principal del conductor: el checklist es un formulario aparte
          (funciona con o sin sesión). */}
      {asset.canFillChecklist && (
        <Button
          className="h-12 w-full gap-2 text-base"
          onClick={() => navigate(`/checklist/${token}`)}
        >
          <ClipboardCheck className="size-5" /> Llenar checklist
        </Button>
      )}

      {/* Uso vigente: desde cuándo. Sin nombres (la ficha es pública). */}
      {asset.canRegisterUse && enUso && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
          <Timer className="mt-0.5 size-5 shrink-0 text-blue-500" aria-hidden />
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-semibold text-foreground">
              En uso desde {horaCorta(enUso.since)}
            </span>
            <span className="text-muted-foreground">
              {enUso.unverified
                ? 'Registrado sin cuenta. Quien lo tiene puede terminarlo aquí.'
                : 'Lo tiene alguien con cuenta: el uso se termina desde la app.'}
            </span>
          </div>
        </div>
      )}

      {muestraUso && (
        <div className={`grid gap-3 ${muestraCombustible ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {asset.canRegisterUse && enUso?.unverified ? (
            <Button
              variant="outline"
              className="h-12 gap-2"
              aria-expanded={panel === 'terminar'}
              onClick={() => abrir('terminar')}
            >
              <StopCircle className="size-5" /> Terminar uso
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-12 gap-2"
              aria-expanded={panel === 'registrar'}
              disabled={enviando || (asset.canRegisterUse && (Boolean(enUso) || noOperativo))}
              onClick={onRegistrar}
            >
              <PlayCircle className="size-5" /> Registrar uso
            </Button>
          )}
          {muestraCombustible && (
            <Button
              variant="outline"
              className="h-12 gap-2"
              onClick={() => avisarProximamente('La gestión de combustible')}
            >
              <Fuel className="size-5" /> Combustible
            </Button>
          )}
        </div>
      )}

      {/* Sin panel abierto: el motivo de un "Registrar uso" deshabilitado. */}
      {asset.canRegisterUse && !enUso && noOperativo && (
        <p className="text-center text-xs text-muted-foreground">
          El equipo no está disponible para su uso en este momento.
        </p>
      )}

      {error && panel === null && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}

      {panel === 'registrar' && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Entrar es mejor (queda a nombre de alguien identificado), así que va
              primero; sin cuenta también se puede, igual que el checklist. */}
          <button
            type="button"
            onClick={() => navigate('/login', { state: { from: location } })}
            className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-left transition active:scale-[0.99]"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <LogIn className="size-4 text-primary" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">Entrar a GMT Link</span>
              <span className="block text-xs leading-snug text-muted-foreground">
                El uso queda a tu nombre y con el checklist de la app.
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>

          <form onSubmit={(e) => void enviarRegistro(e)} className="flex flex-col gap-3" noValidate>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <UserRound className="size-4 text-muted-foreground" aria-hidden /> Continuar sin
              cuenta
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="uso-nombre">Tu nombre</Label>
              <Input
                id="uso-nombre"
                autoComplete="name"
                maxLength={120}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                aria-invalid={error !== null && nombre.trim() === ''}
                placeholder="Nombre y apellido"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="uso-comentario">
                Comentario <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="uso-comentario"
                maxLength={MAX_COMENTARIO}
                rows={2}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Ej. medición en poza R3"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              El registro quedará marcado como no verificado.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1"
                onClick={() => abrir(null)}
                disabled={enviando}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={enviando}>
                {enviando ? 'Registrando…' : 'Registrar uso'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {panel === 'terminar' && (
        <form
          onSubmit={(e) => void enviarTermino(e)}
          className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 animate-in fade-in slide-in-from-top-2 duration-200"
          noValidate
        >
          <p className="text-sm font-semibold text-foreground">¿Terminaste de usar el equipo?</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="termino-comentario">
              Comentario <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="termino-comentario"
              maxLength={MAX_COMENTARIO}
              rows={2}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej. quedó en la bodega de faena"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => abrir(null)}
              disabled={enviando}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={enviando}>
              {enviando ? 'Terminando…' : 'Terminar uso'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
