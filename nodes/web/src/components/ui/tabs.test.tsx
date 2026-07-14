import { describe, it, expect, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabPanel, type TabItem } from './tabs';

/**
 * Contrato de accesibilidad del canon de tabs (modo button): patrón WAI-ARIA
 * completo — enlace tab↔panel (`id`/`aria-controls`/`aria-labelledby`), roving
 * tabindex y navegación por flechas/Home/End en el tablist.
 */

type V = 'uno' | 'dos' | 'tres';

const ITEMS: ReadonlyArray<TabItem<V>> = [
  { value: 'uno', label: 'Uno' },
  { value: 'dos', label: 'Dos' },
  { value: 'tres', label: 'Tres' },
];

/** Envoltura controlada: mantiene la pestaña activa como lo hace un consumidor real. */
function ControlledTabs({
  idBase,
  initial = 'uno',
  onChange,
}: {
  idBase?: string;
  initial?: V;
  onChange?: (value: V) => void;
}): ReactNode {
  const [value, setValue] = useState<V>(initial);
  return (
    <Tabs<V>
      idBase={idBase}
      items={ITEMS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      aria-label="Grupo de prueba"
    />
  );
}

describe('Tabs (modo button) — enlace ARIA tab↔panel', () => {
  it('cada tab expone id y aria-controls derivados de idBase', () => {
    render(<ControlledTabs idBase="grp" />);
    const uno = screen.getByRole('tab', { name: 'Uno' });
    expect(uno).toHaveAttribute('id', 'grp-tab-uno');
    expect(uno).toHaveAttribute('aria-controls', 'grp-panel-uno');
    const tres = screen.getByRole('tab', { name: 'Tres' });
    expect(tres).toHaveAttribute('id', 'grp-tab-tres');
    expect(tres).toHaveAttribute('aria-controls', 'grp-panel-tres');
  });

  it('sin idBase, cada tab recibe un id único (fallback useId)', () => {
    render(<ControlledTabs />);
    const ids = screen.getAllByRole('tab').map((tab) => tab.getAttribute('id'));
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Tabs (modo button) — roving tabindex', () => {
  it('solo el tab activo es tabbable (tabIndex 0); el resto queda en -1', () => {
    render(<ControlledTabs idBase="grp" initial="dos" />);
    expect(screen.getByRole('tab', { name: 'Dos' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Tres' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('Tabs (modo button) — navegación por teclado', () => {
  it('ArrowRight activa el siguiente tab y le mueve el foco', () => {
    const onChange = vi.fn();
    render(<ControlledTabs idBase="grp" initial="uno" onChange={onChange} />);
    const uno = screen.getByRole('tab', { name: 'Uno' });
    uno.focus();
    fireEvent.keyDown(uno, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenLastCalledWith('dos');
    const dos = screen.getByRole('tab', { name: 'Dos' });
    expect(dos).toHaveAttribute('aria-selected', 'true');
    expect(dos).toHaveFocus();
  });

  it('ArrowLeft desde el primero envuelve al último', () => {
    const onChange = vi.fn();
    render(<ControlledTabs idBase="grp" initial="uno" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenLastCalledWith('tres');
    expect(screen.getByRole('tab', { name: 'Tres' })).toHaveFocus();
  });

  it('Home activa el primero y End el último', () => {
    const onChange = vi.fn();
    render(<ControlledTabs idBase="grp" initial="dos" onChange={onChange} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('uno');
    expect(screen.getByRole('tab', { name: 'Uno' })).toHaveFocus();

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('tres');
    expect(screen.getByRole('tab', { name: 'Tres' })).toHaveFocus();
  });

  it('otras teclas no cambian el tab', () => {
    const onChange = vi.fn();
    render(<ControlledTabs idBase="grp" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TabPanel', () => {
  it('emite role=tabpanel enlazado al tab por id/aria-labelledby y es enfocable', () => {
    render(
      <TabPanel idBase="grp" value="dos">
        Contenido de la pestaña
      </TabPanel>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'grp-panel-dos');
    expect(panel).toHaveAttribute('aria-labelledby', 'grp-tab-dos');
    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel).toHaveTextContent('Contenido de la pestaña');
  });
});
