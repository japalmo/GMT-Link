import { LayoutDashboard } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth } from '@/context/auth-context';
import { OnboardingTour } from '@/components/onboarding-tour';

/**
 * Dashboard placeholder (el real, modular y configurable, llega en §6-2.1).
 * Sirve para validar el shell: saluda al usuario autenticado.
 */
export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Dashboard</p>
        <h1 className="text-2xl font-bold tracking-tight">
          Hola{user ? `, ${user.firstName}` : ''}.
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Bienvenido a GTM Link. Tu panel personalizado con widgets por rol
          llegará en una próxima etapa.
        </p>
      </header>

      <OnboardingTour />

      <Card>
        <CardHeader>
          <CardTitle>Tu espacio de trabajo</CardTitle>
          <CardDescription>
            Aún no hay widgets configurados.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <LayoutDashboard className="size-8 text-muted-foreground" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">
            Cuando se habilite el dashboard modular podrás acomodar tus widgets y
            la disposición quedará guardada.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
