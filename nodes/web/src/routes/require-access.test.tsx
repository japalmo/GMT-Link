import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireModule } from '@/routes/require-access';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));

function renderAt(modules: string[]) {
  mockUseAuth.mockReturnValue({ user: { modules, permissions: [] } });
  return render(
    <MemoryRouter initialEntries={['/proyectos']}>
      <Routes>
        <Route path="/" element={<div>inicio</div>} />
        <Route
          path="/proyectos"
          element={<RequireModule module="proyectos"><div>proyectos</div></RequireModule>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renderiza la sección si el módulo está permitido', () => {
    renderAt(['dashboard', 'proyectos']);
    expect(screen.getByText('proyectos')).toBeInTheDocument();
  });

  it('redirige a Inicio si el módulo no está permitido', () => {
    renderAt(['dashboard', 'finanzas']);
    expect(screen.getByText('inicio')).toBeInTheDocument();
  });
});
