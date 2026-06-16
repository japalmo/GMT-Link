import { Outlet } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SidebarProvider, useSidebar } from '@/components/layout/use-sidebar';
import { SidebarContent } from '@/components/layout/sidebar';
import { NotificationBell } from '@/components/notifications/notification-bell';
import logoMid from '@/assets/branding/logo-mid.png';

/** Topbar: solo visible en móvil; ofrece el botón hamburguesa del drawer. */
function Topbar() {
  const { openMobile } = useSidebar();
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={openMobile}
        aria-label="Abrir menú"
        className="text-muted-foreground"
      >
        <Menu aria-hidden />
      </Button>
      <img src={logoMid} alt="GTM Link" className="h-6 w-auto object-contain" />
      <div className="ml-auto">
        <NotificationBell />
      </div>
    </header>
  );
}

/** Drawer del sidebar para móvil, montado sobre @radix-ui/react-dialog. */
function MobileDrawer() {
  const { mobileOpen, closeMobile } = useSidebar();
  return (
    <Dialog.Root open={mobileOpen} onOpenChange={(open) => (open ? undefined : closeMobile())}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[1px] md:hidden',
            'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
          )}
        />
        <Dialog.Content
          aria-label="Menú de navegación"
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border shadow-lg outline-none md:hidden',
            'data-[state=open]:animate-content-in data-[state=closed]:animate-content-out',
          )}
        >
          <Dialog.Title className="sr-only">Navegación</Dialog.Title>
          <Dialog.Description className="sr-only">
            Menú principal de la aplicación.
          </Dialog.Description>
          <Dialog.Close
            className={cn(
              'absolute right-2 top-3 z-10 rounded-sm p-1 text-muted-foreground outline-none transition-colors',
              'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label="Cerrar menú"
          >
            <X className="size-4" aria-hidden />
          </Dialog.Close>
          <SidebarContent forceExpanded onNavigate={closeMobile} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShellLayout() {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Salto al contenido para usuarios de teclado/lector de pantalla. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Saltar al contenido
      </a>

      {/* Sidebar fijo en escritorio; ancho según colapso */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 border-r border-border md:block">
        <CollapsibleAside />
      </aside>

      {/* Drawer móvil */}
      <MobileDrawer />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="flex-1 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Ancho del rail de escritorio reacciona al colapso. */
function CollapsibleAside() {
  const { collapsed } = useSidebar();
  return (
    <div className={cn('h-full transition-[width]', collapsed ? 'w-16' : 'w-64')}>
      <SidebarContent />
    </div>
  );
}

/** Shell de la aplicación (Etapa 0.7): sidebar + topbar + canvas con <Outlet/>. */
export function AppShell() {
  return (
    <SidebarProvider>
      <ShellLayout />
    </SidebarProvider>
  );
}
