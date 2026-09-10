import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { errorToMessage, unlockPublicObraDashboard } from '@/lib/api';

/**
 * Puerta del tablero público protegido. Se abre de dos formas, como se pidió:
 * con la clave del proyecto o iniciando sesión en GMT Link con un usuario que
 * ya tenga permiso para ver esa obra.
 *
 * El pase se guarda en `sessionStorage` y no en `localStorage`: dura lo que
 * dura la pestaña. En una TV de faena la pestaña no se cierra en todo el turno,
 * y en un computador prestado no queda el acceso abierto para el que sigue.
 */

function clave(token: string): string {
  return `gmt.obra.pase.${token}`;
}

export function leerPase(token: string): string | null {
  try {
    return window.sessionStorage.getItem(clave(token));
  } catch {
    // Modo privado o almacenamiento bloqueado: se pedirá la clave otra vez.
    return null;
  }
}

export function guardarPase(token: string, pase: string): void {
  try {
    window.sessionStorage.setItem(clave(token), pase);
  } catch {
    // Sin dónde guardarlo el tablero igual abre; solo volverá a pedir la clave.
  }
}

export function olvidarPase(token: string): void {
  try {
    window.sessionStorage.removeItem(clave(token));
  } catch {
    // Nada que hacer: el pase vencido se rechaza igual en el backend.
  }
}

export function PuertaClave({
  token,
  onAbierto,
}: {
  token: string;
  onAbierto: () => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!password.trim() || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const { pass } = await unlockPublicObraDashboard(token, password);
      guardarPase(token, pass);
      setPassword('');
      onAbierto();
    } catch (err) {
      setError(errorToMessage(err, 'La clave no es correcta.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="vidrio w-full max-w-sm rounded-xl p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold">Tablero protegido</h2>
            <p className="text-xs text-white/70">
              Esta obra pide clave para ver su avance.
            </p>
          </div>
        </div>

        <form onSubmit={abrir} className="mt-5 flex flex-col gap-3">
          <label htmlFor="clave-obra" className="text-xs uppercase tracking-wide text-white/60">
            Clave del enlace
          </label>
          <input
            id="clave-obra"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            autoFocus
            placeholder="Ingresa la clave"
            className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/50"
          />

          {error && (
            <p className="rounded-md bg-red-500/25 px-3 py-2 text-xs text-red-100" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando || password.trim().length === 0}
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? 'Verificando…' : 'Ver el avance'}
          </button>
        </form>

        <div className="mt-5 border-t border-white/15 pt-4">
          <p className="text-xs text-white/60">¿Trabajas en GMT?</p>
          <Link
            to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}
            className="mt-2 flex items-center justify-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm transition-colors hover:bg-white/10"
          >
            <LogIn className="size-4" aria-hidden />
            Iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
