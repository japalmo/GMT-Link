import { forwardRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Raíz del modal. Controlable (open/onOpenChange) o no controlado. */
const Modal = Dialog.Root;

/** Disparador accesible. Usar `asChild` para envolver un Button. */
const ModalTrigger = Dialog.Trigger;

/** Cierra el modal desde dentro (p. ej. en el footer). Usar `asChild`. */
const ModalClose = Dialog.Close;

const ModalOverlay = forwardRef<
  React.ElementRef<typeof Dialog.Overlay>,
  React.ComponentPropsWithoutRef<typeof Dialog.Overlay>
>(({ className, ...props }, ref) => (
  <Dialog.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[1px]',
      'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
      className,
    )}
    {...props}
  />
));
ModalOverlay.displayName = 'ModalOverlay';

const ModalContent = forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Dialog.Content>
>(({ className, children, ...props }, ref) => (
  <Dialog.Portal>
    <ModalOverlay />
    <Dialog.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col gap-4 border border-border bg-card text-card-foreground shadow-lg outline-none',
        // Mobile-first: hoja anclada al borde inferior, ancho completo.
        'inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-lg p-6',
        // ≥640px: tarjeta centrada.
        'sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg',
        'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg',
        'data-[state=open]:animate-content-in data-[state=closed]:animate-content-out',
        className,
      )}
      {...props}
    >
      {children}
      <Dialog.Close
        className={cn(
          'absolute right-4 top-4 rounded-sm text-muted-foreground transition-colors',
          'hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none',
        )}
      >
        <X className="size-4" aria-hidden />
        <span className="sr-only">Cerrar</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
));
ModalContent.displayName = 'ModalContent';

function ModalHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 pr-8 text-left', className)}
      {...props}
    />
  );
}
ModalHeader.displayName = 'ModalHeader';

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
ModalFooter.displayName = 'ModalFooter';

const ModalTitle = forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
ModalTitle.displayName = 'ModalTitle';

const ModalDescription = forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
ModalDescription.displayName = 'ModalDescription';

export {
  Modal,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalTitle,
  ModalDescription,
};
