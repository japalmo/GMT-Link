import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Iniciales (nombre + apellido) en mayúsculas para el fallback del avatar. */
function initials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return (a + b).toUpperCase() || '?';
}

/** Tamaños disponibles del avatar. */
type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'size-9 text-xs',
  md: 'size-12 text-sm',
  lg: 'size-16 text-lg',
};

/**
 * Avatar de una persona. Si hay `avatarUrl`, muestra la imagen (con `alt`); si no
 * existe o falla la carga, cae a las iniciales sobre un fondo neutro. Compartido
 * por el Directorio y el Perfil para mantener un único patrón visual.
 */
export function PersonAvatar({
  firstName,
  lastName,
  avatarUrl,
  size = 'sm',
  className,
}: {
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  const fullName = `${firstName} ${lastName}`.trim();
  const showImage = Boolean(avatarUrl) && !failed;

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-foreground',
        SIZE_CLASS[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={avatarUrl ?? undefined}
          alt={`Avatar de ${fullName}`}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials(firstName, lastName)}</span>
      )}
    </span>
  );
}
