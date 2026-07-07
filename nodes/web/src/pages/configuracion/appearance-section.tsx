import { useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { errorToMessage } from '@/lib/api';
import { useTheme } from '@/components/theme/theme-provider';
import type { ThemePreference } from '@/types/settings';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'system',
    label: 'Sistema',
    description: 'Sigue tu sistema operativo.',
    icon: Monitor,
  },
  { value: 'light', label: 'Claro', description: 'Siempre en claro.', icon: Sun },
  { value: 'dark', label: 'Oscuro', description: 'Siempre en oscuro.', icon: Moon },
];

/**
 * Sección "Apariencia" (§6-2.3a). Selector de tema (sistema/claro/oscuro) como
 * radiogroup accesible que aplica el cambio al instante vía {@link useTheme}.
 */
export function AppearanceSection(): ReactNode {
  const { theme, setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ThemePreference | null>(null);

  const handleSelect = async (value: ThemePreference): Promise<void> => {
    if (value === theme) return;
    setError(null);
    setSaving(value);
    try {
      await setTheme(value);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el tema.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apariencia</CardTitle>
        <CardDescription>
          Elige el tema de la interfaz. El cambio se aplica de inmediato.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset>
          <legend className="sr-only">Tema de la interfaz</legend>
          <div
            role="radiogroup"
            aria-label="Tema de la interfaz"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  disabled={saving !== null}
                  onClick={() => void handleSelect(option.value)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-md border p-4 text-left transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    selected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 items-center justify-center rounded-md',
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <Alert variant="destructive" live className="mt-3">
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
