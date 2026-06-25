import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FileText, FolderArchive, IdCard } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Una pestaña de la sección Perfil. */
interface ProfileTab {
  to: string;
  label: string;
  icon: typeof IdCard;
}

const TABS: ReadonlyArray<ProfileTab> = [
  { to: '/perfil', label: 'Mis datos', icon: IdCard },
  { to: '/perfil/cv', label: 'Mi CV', icon: FileText },
  { to: '/perfil/documentos', label: 'Mis documentos', icon: FolderArchive },
];

/**
 * Navegación por pestañas entre las sub-páginas del Perfil ("Mis datos",
 * "Mi CV", "Mis documentos"). Cada sub-página la renderiza bajo su cabecera.
 * Usa `NavLink` con `end` en "Mis datos" para que no quede activa en las demás.
 * Responsive: scroll horizontal en móvil.
 */
export function ProfileTabs(): ReactNode {
  return (
    <nav aria-label="Secciones de mi perfil" className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.to === '/perfil'}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {tab.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
