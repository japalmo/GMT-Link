import DesignDemo from '@/pages/DesignDemo';

/**
 * Punto de entrada de la app. En 0.6 renderiza directamente la demo del
 * design system (DoD de la etapa). El router llega en 0.7.
 */
export default function App() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <DesignDemo />
    </main>
  );
}
