import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Contenedor reutilizable de una sección del CV (Experiencia / Educación /
 * Certificaciones). Provee cabecera con título, descripción y botón "Agregar", y
 * el estado vacío. La carga/error del CV se resuelven a nivel de página, no por
 * sección. El contenido (la lista) se pasa por `children`.
 */
export function CvSection({
  title,
  description,
  isEmpty,
  emptyMessage,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  description: string;
  isEmpty: boolean;
  emptyMessage: string;
  onAdd: () => void;
  addLabel: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <EmptyState
            message={emptyMessage}
            action={
              <Button size="sm" variant="ghost" onClick={onAdd}>
                <Plus aria-hidden />
                {addLabel}
              </Button>
            }
          />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
