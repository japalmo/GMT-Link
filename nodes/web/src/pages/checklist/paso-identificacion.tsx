import type { ReactNode } from 'react';
import { ArrowRight, LogIn, UserRound } from 'lucide-react';

/**
 * Primer paso del checklist cuando NO hay sesión: elegir cómo llenarlo.
 *
 * Existe porque en faena hay conductores de terceros y gente que todavía no
 * tiene cuenta, y exigir login significaba que el checklist no se hiciera. Pero
 * entrar con la cuenta es mejor —queda firmado por alguien identificado y los
 * datos se prellenan solos—, así que va primero y se dice por qué.
 *
 * Con sesión iniciada este paso no se dibuja: el asistente arranca en los datos
 * del conductor.
 */
export function PasoIdentificacion({
  onEntrar,
  onContinuarSinCuenta,
}: {
  onEntrar: () => void;
  onContinuarSinCuenta: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onEntrar}
        className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-left transition active:scale-[0.99]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <LogIn className="size-5 text-primary" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[16px] font-semibold">Entrar a GMT Link</span>
          <span className="block text-[13px] leading-snug text-muted-foreground">
            Tus datos se llenan solos y el checklist queda firmado a tu nombre.
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onContinuarSinCuenta}
        className="flex items-center gap-3 rounded-2xl border border-border p-4 text-left transition active:scale-[0.99]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
          <UserRound className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-[16px] font-semibold">Continuar sin cuenta</span>
          <span className="block text-[13px] leading-snug text-muted-foreground">
            Tendrás que escribir tus datos, y el registro quedará marcado como no
            verificado.
          </span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}
