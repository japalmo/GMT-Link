import type { ReactNode } from 'react';
import { FileText, FolderArchive, IdCard } from 'lucide-react';
import { NavTabs, type NavTabItem } from '@/components/ui/tabs';

const TABS: ReadonlyArray<NavTabItem> = [
  { to: '/perfil', label: 'Mis datos', icon: IdCard, end: true },
  { to: '/perfil/cv', label: 'Mi CV', icon: FileText },
  { to: '/perfil/documentos', label: 'Mis documentos', icon: FolderArchive },
];

/**
 * Navegación por pestañas entre las sub-páginas del Perfil ("Mis datos",
 * "Mi CV", "Mis documentos"). Ensambla la primitiva `NavTabs` del design system
 * (modo NavLink → `aria-current="page"`). "Mis datos" usa `end` para no quedar
 * activa en las sub-rutas.
 */
export function ProfileTabs(): ReactNode {
  return <NavTabs items={TABS} aria-label="Secciones de mi perfil" />;
}
