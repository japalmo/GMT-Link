import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AssetPublicView } from '@/types/assets';
import { AccionesActivo } from './activo-acciones';

const { mockUseAuth, api, toastMock, navigateMock } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  api: {
    registerPublicAssetUse: vi.fn(),
    endPublicAssetUse: vi.fn(),
    resolveAssetByToken: vi.fn(),
  },
  toastMock: { info: vi.fn(), success: vi.fn() },
  navigateMock: vi.fn(),
}));

vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  ...api,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

function ficha(over: Partial<AssetPublicView> = {}): AssetPublicView {
  return {
    code: 'GMT-EQ-0001',
    type: 'EQUIPO',
    name: 'Estación total',
    description: null,
    manufacturer: null,
    vehicleSubtype: null,
    status: 'DISPONIBLE',
    project: null,
    documents: [],
    lastChecklist: null,
    canFillChecklist: false,
    canRegisterUse: true,
    activeUse: null,
    ...over,
  };
}

function renderAcciones(asset: AssetPublicView, onAssetChange = vi.fn()) {
  render(
    <MemoryRouter>
      <AccionesActivo asset={asset} token="tok" onAssetChange={onAssetChange} />
    </MemoryRouter>,
  );
  return onAssetChange;
}

describe('AccionesActivo — ficha pública', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null });
  });

  it('equipo: muestra Registrar uso y Combustible', () => {
    renderAcciones(ficha());
    expect(screen.getByRole('button', { name: /Registrar uso/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Combustible/i })).toBeInTheDocument();
  });

  it('maquinaria: los mismos botones, solo visuales (avisan "próximamente")', () => {
    renderAcciones(ficha({ type: 'MAQUINARIA', canRegisterUse: false }));

    fireEvent.click(screen.getByRole('button', { name: /Registrar uso/i }));
    fireEvent.click(screen.getByRole('button', { name: /Combustible/i }));

    expect(toastMock.info).toHaveBeenCalledTimes(2);
    expect(api.registerPublicAssetUse).not.toHaveBeenCalled();
    // No abre el formulario de nombre.
    expect(screen.queryByLabelText(/Tu nombre/i)).not.toBeInTheDocument();
  });

  it('vehículo: no muestra Registrar uso ni Combustible', () => {
    renderAcciones(ficha({ type: 'VEHICULO', canRegisterUse: false, canFillChecklist: true }));
    expect(screen.getByRole('button', { name: /Llenar checklist/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar uso/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Combustible/i })).not.toBeInTheDocument();
  });

  it('sin sesión: pide nombre (obligatorio) + comentario y registra el uso', async () => {
    const actualizado = ficha({
      status: 'EN_USO',
      activeUse: { since: '2026-10-01T10:30:00.000Z', unverified: true },
    });
    api.registerPublicAssetUse.mockResolvedValueOnce(actualizado);
    const onAssetChange = renderAcciones(ficha());

    fireEvent.click(screen.getByRole('button', { name: /Registrar uso/i }));
    // Enviar sin nombre no llama a la API.
    fireEvent.click(screen.getAllByRole('button', { name: /^Registrar uso$/i }).at(-1)!);
    expect(await screen.findByText(/Necesitamos tu nombre/i)).toBeInTheDocument();
    expect(api.registerPublicAssetUse).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Tu nombre/i), { target: { value: '  Pedro Soto ' } });
    fireEvent.change(screen.getByLabelText(/Comentario/i), { target: { value: 'poza R3' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^Registrar uso$/i }).at(-1)!);

    await waitFor(() =>
      expect(api.registerPublicAssetUse).toHaveBeenCalledWith('tok', {
        declaredName: 'Pedro Soto',
        comment: 'poza R3',
      }),
    );
    expect(onAssetChange).toHaveBeenCalledWith(actualizado);
  });

  it('con sesión: lleva al flujo normal de la app (sin formulario)', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u-1' } });
    api.resolveAssetByToken.mockResolvedValueOnce({ id: 'a-1' });
    renderAcciones(ficha());

    fireEvent.click(screen.getByRole('button', { name: /Registrar uso/i }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/recursos?asset=a-1&accion=reportar-uso'),
    );
    expect(screen.queryByLabelText(/Tu nombre/i)).not.toBeInTheDocument();
  });

  it('uso sin cuenta vigente: ofrece Terminar uso y lo cierra', async () => {
    const libre = ficha();
    api.endPublicAssetUse.mockResolvedValueOnce(libre);
    const onAssetChange = renderAcciones(
      ficha({
        status: 'EN_USO',
        activeUse: { since: '2026-10-01T10:30:00.000Z', unverified: true },
      }),
    );

    expect(screen.queryByRole('button', { name: /Registrar uso/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Terminar uso/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Terminar uso$/i }).at(-1)!);

    await waitFor(() =>
      expect(api.endPublicAssetUse).toHaveBeenCalledWith('tok', { comment: undefined }),
    );
    expect(onAssetChange).toHaveBeenCalledWith(libre);
  });

  it('uso de alguien CON cuenta: no se puede terminar ni registrar desde la ficha', () => {
    renderAcciones(
      ficha({
        status: 'EN_USO',
        activeUse: { since: '2026-10-01T10:30:00.000Z', unverified: false },
      }),
    );
    expect(screen.queryByRole('button', { name: /Terminar uso/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar uso/i })).toBeDisabled();
    expect(screen.getByText(/se termina desde la app/i)).toBeInTheDocument();
  });

  it('equipo en mantenimiento: Registrar uso deshabilitado con el motivo', () => {
    renderAcciones(ficha({ status: 'MANTENIMIENTO' }));
    expect(screen.getByRole('button', { name: /Registrar uso/i })).toBeDisabled();
    expect(screen.getByText(/no está disponible/i)).toBeInTheDocument();
  });
});
