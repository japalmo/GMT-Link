import { Construction } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Página genérica "en construcción" para los módulos del roadmap aún no
 * implementados (Finanzas, Operaciones, Recursos, Herramientas, V-metric).
 * Mantiene el shell navegable sin pretender funcionalidad que no existe.
 */
export default function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>En construcción</CardTitle>
          <CardDescription>Este módulo llegará en una próxima etapa.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Construction className="size-8 text-muted-foreground" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">
            Estamos trabajando en esta sección. Vuelve pronto.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
