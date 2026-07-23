import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { errorToMessage } from '@/lib/api';

export interface FreshFileLinkProps {
  /** Pide al backend la URL fresca del archivo (se invoca en cada clic). */
  getUrl: () => Promise<{ url: string }>;
  /** Clases del enlace (el caller define el estilo visual, como en un `<a>`). */
  className?: string;
  /** Etiqueta accesible opcional (útil cuando el texto visible es genérico). */
  'aria-label'?: string;
  children: ReactNode;
}

/**
 * Enlace (botón con estilo de link) que abre un archivo en una pestaña nueva
 * pidiendo la URL FRESCA al backend en el momento del clic (Fase 1B). Nunca se
 * navega el `fileUrl` persistido: para archivos nuevos es una clave de storage
 * no navegable y para legados con R2 puede ser una URL prefirmada ya vencida.
 *
 * La pestaña se abre de forma síncrona (dentro del gesto del usuario) para no
 * gatillar el bloqueador de ventanas emergentes; la URL se asigna al llegar.
 * Si la petición falla se cierra la pestaña y se informa con un toast.
 */
export function FreshFileLink({
  getUrl,
  className,
  children,
  ...rest
}: FreshFileLinkProps): ReactNode {
  const [opening, setOpening] = useState(false);

  async function open(): Promise<void> {
    setOpening(true);
    const win = window.open('', '_blank');
    try {
      const { url } = await getUrl();
      if (win) {
        win.opener = null;
        win.location.replace(url);
      } else {
        // Bloqueador activo: intento directo (puede ser permitido al ser mismo gesto).
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      win?.close();
      toast.error(errorToMessage(error, 'No se pudo abrir el archivo.'));
    } finally {
      setOpening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={opening}
      aria-busy={opening}
      aria-label={rest['aria-label']}
      className={cn('cursor-pointer text-left disabled:cursor-wait disabled:opacity-60', className)}
    >
      {children}
    </button>
  );
}
