import { useEffect, useState, type ReactNode } from 'react';
import { Campo, ENTRADA, Aviso, SelectorFecha } from '@/components/form-wizard';
import { listDocuments } from '@/lib/api';
import type { AuthedUser } from '@/types/auth';

/**
 * Datos del conductor: nombre, correo y licencias.
 *
 * Los campos son los MISMOS con sesión y sin ella; lo que cambia es de dónde
 * salen. Con sesión se prellenan (el nombre y el correo desde la cuenta, el
 * vencimiento de la licencia desde el documento de RRHH) y quedan editables,
 * porque el dato de RRHH puede estar viejo y quien firma responde por lo que
 * declara. Lo que corrija acá vale para ESTE checklist: si cambió de verdad, va
 * a su perfil, y el aviso lo dice.
 *
 * El correo no es opcional: es a donde llega el PDF, la copia del documento que
 * la persona acaba de firmar.
 */

/** Clases de licencia chilenas, en el orden en que las lee la gente. */
const CLASES = ['B', 'A1', 'A2', 'A3', 'A4', 'A5', 'C', 'D', 'E', 'F'] as const;

export interface DatosConductor {
  nombre: string;
  correo: string;
  claseLicencia: string;
  venceLicencia: string;
  venceInterna: string;
}

export function PasoConductor({
  usuario,
  datos,
  set,
}: {
  /** `null` cuando se está llenando sin cuenta. */
  usuario: AuthedUser | null;
  datos: DatosConductor;
  set: <K extends keyof DatosConductor>(campo: K, valor: DatosConductor[K]) => void;
}): ReactNode {
  const [buscandoLicencia, setBuscandoLicencia] = useState(false);
  const [sinLicenciaCargada, setSinLicenciaCargada] = useState(false);

  // Prellenado desde la cuenta. Solo si el campo está vacío: si la persona ya
  // escribió algo, pisárselo sería perder lo que corrigió.
  useEffect(() => {
    if (!usuario) return;
    if (!datos.nombre) set('nombre', `${usuario.firstName} ${usuario.lastName}`.trim());
    if (!datos.correo) set('correo', usuario.email);
    // Depende SOLO de `usuario`: `set` y `datos` cambian en cada tecla, y si
    // entraran acá el prellenado se re-dispararía mientras la persona escribe.
  }, [usuario]);

  // Vencimiento de la licencia desde los documentos de RRHH.
  useEffect(() => {
    if (!usuario || datos.venceLicencia) return;
    let vivo = true;
    setBuscandoLicencia(true);
    listDocuments()
      .then((docs) => {
        if (!vivo) return;
        const licencia = docs
          .filter((d) => /licencia/i.test(`${d.type} ${d.name}`))
          // Si renovó, manda la nueva.
          .sort((a, b) => (b.expiresAt ?? '').localeCompare(a.expiresAt ?? ''))[0];
        if (licencia?.expiresAt) {
          set('venceLicencia', licencia.expiresAt.slice(0, 10));
        } else {
          setSinLicenciaCargada(true);
        }
      })
      .catch(() => {
        // Que RRHH no responda no puede impedir llenar el checklist: se deja el
        // campo vacío para que lo escriba a mano.
        if (vivo) setSinLicenciaCargada(true);
      })
      .finally(() => {
        if (vivo) setBuscandoLicencia(false);
      });
    return () => {
      vivo = false;
    };
    // Igual que arriba: solo `usuario`.
  }, [usuario]);

  return (
    <div className="flex flex-col gap-4">
      {usuario && (
        <Aviso mensaje="Estos datos vienen de tu perfil. Si los corriges acá, el cambio vale solo para este checklist; si cambiaron de verdad, actualízalos en tu perfil." />
      )}

      <Campo etiqueta="Nombre completo">
        <input
          className={ENTRADA}
          value={datos.nombre}
          onChange={(e) => set('nombre', e.target.value)}
          placeholder="Nombre y apellido"
          autoComplete="name"
        />
      </Campo>

      <Campo etiqueta="Correo" hint="Te enviamos el PDF del checklist a esta dirección.">
        <input
          className={ENTRADA}
          type="email"
          inputMode="email"
          value={datos.correo}
          onChange={(e) => set('correo', e.target.value)}
          placeholder="tu@correo.cl"
          autoComplete="email"
        />
      </Campo>

      <Campo etiqueta="Clase de licencia municipal">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Clase de licencia">
          {CLASES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={datos.claseLicencia === c}
              onClick={() => set('claseLicencia', datos.claseLicencia === c ? '' : c)}
              className={`h-11 min-w-[54px] rounded-2xl border px-3 text-[15px] font-medium transition active:scale-[0.97] ${
                datos.claseLicencia === c
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </Campo>

      <Campo
        etiqueta="Vencimiento de la licencia municipal"
        hint={
          buscandoLicencia
            ? 'Buscando en tus documentos…'
            : sinLicenciaCargada
              ? 'No encontramos tu licencia cargada en GMT Link. Escríbela acá y súbela después en tu perfil.'
              : undefined
        }
      >
        <SelectorFecha
          valor={datos.venceLicencia}
          onChange={(v) => set('venceLicencia', v)}
          rango="libre"
        />
      </Campo>

      <Campo
        etiqueta="Vencimiento de la licencia interna (faena)"
        hint="Déjalo sin definir si esta faena no exige acreditación."
      >
        <SelectorFecha
          valor={datos.venceInterna}
          onChange={(v) => set('venceInterna', v)}
          rango="libre"
        />
      </Campo>
    </div>
  );
}
