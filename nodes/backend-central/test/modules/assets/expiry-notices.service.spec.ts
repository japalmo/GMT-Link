import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpiryNoticesService } from '../../../src/modules/assets/expiry-notices.service';

/**
 * Lo que importa verificar del barrido:
 *
 *  · IDEMPOTENCIA. Es la propiedad de la que depende que la alerta sirva. Un
 *    barrido que corre dos veces el mismo día no puede avisar dos veces.
 *  · UN FALLO NO DETIENE EL BARRIDO. Si el correo de una persona revienta, el
 *    resto tiene que recibir su aviso igual.
 *  · SOLO DOCUMENTOS APROBADOS Y DE VEHICULOS.
 *  · La preferencia de correo APAGADA no cancela la notificacion en la app.
 */

const HOY = new Date(2026, 7, 7);

function enDias(n: number): Date {
  const d = new Date(HOY);
  d.setDate(d.getDate() + n);
  return d;
}

interface Mocks {
  prisma: any;
  notifications: any;
  email: any;
}

function construir(overrides: Partial<Mocks> = {}) {
  const enviados: Array<{ documentId: string; userId: string; clave: string }> = [];

  const prisma = {
    rolePermission: {
      findMany: vi.fn().mockResolvedValue([{ role: { key: 'vehicle_admin' } }]),
    },
    membership: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'u-1' }]),
    },
    assetDocument: { findMany: vi.fn().mockResolvedValue([]) },
    assetDocumentExpiryNotice: {
      // El "ya enviado" se resuelve contra la lista en memoria: así el test
      // ejerce la deduplicación de verdad y no un mock que siempre dice que no.
      findUnique: vi.fn(({ where }: any) => {
        const { documentId, userId, clave } = where.documentId_userId_clave;
        const hit = enviados.find(
          (e) => e.documentId === documentId && e.userId === userId && e.clave === clave,
        );
        return Promise.resolve(hit ? { id: 'x' } : null);
      }),
      create: vi.fn(({ data }: any) => {
        enviados.push({ documentId: data.documentId, userId: data.userId, clave: data.clave });
        return Promise.resolve({ id: 'n-1' });
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        email: 'admin@gmt.cl',
        preferences: { notifyEmail: true },
      }),
    },
    ...(overrides.prisma ?? {}),
  };

  const notifications = { create: vi.fn().mockResolvedValue({ id: 'noti' }), ...(overrides.notifications ?? {}) };
  const email = { send: vi.fn().mockResolvedValue(undefined), ...(overrides.email ?? {}) };

  const service = new ExpiryNoticesService(prisma as any, notifications as any, email as any);
  return { service, prisma, notifications, email, enviados };
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    name: 'Revisión técnica',
    expirationDate: enDias(10),
    asset: { code: 'GMT-VH-0002', name: 'JAC T8', identifier: 'SKWR57' },
    ...overrides,
  };
}

describe('ExpiryNoticesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('avisa por los dos canales cuando corresponde el hito', async () => {
    const { service, prisma, notifications, email } = construir();
    prisma.assetDocument.findMany.mockResolvedValue([doc()]);

    const resumen = await service.barrer(HOY);

    expect(resumen.avisosEnviados).toBe(1);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledTimes(1);
    // El aviso identifica el vehículo por su patente, no por el id interno.
    expect(email.send.mock.calls[0][0].subject).toContain('Revisión técnica');
    expect(email.send.mock.calls[0][0].body).toContain('SKWR57');
  });

  it('NO repite el aviso si el barrido corre dos veces', async () => {
    // Es la propiedad central: sin esto, un proceso horario mandaría 24 avisos.
    const { service, prisma, notifications } = construir();
    prisma.assetDocument.findMany.mockResolvedValue([doc()]);

    const primera = await service.barrer(HOY);
    const segunda = await service.barrer(HOY);

    expect(primera.avisosEnviados).toBe(1);
    expect(segunda.avisosEnviados).toBe(0);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('avisa de nuevo cuando cambia el hito', async () => {
    const { service, prisma } = construir();
    prisma.assetDocument.findMany.mockResolvedValue([doc({ expirationDate: enDias(3) })]);

    await service.barrer(HOY);                                  // dia-3
    const despues = await service.barrer(new Date(2026, 7, 9)); // dia-1

    expect(despues.avisosEnviados).toBe(1);
  });

  it('no avisa si al documento le falta más de un mes', async () => {
    const { service, prisma, notifications } = construir();
    prisma.assetDocument.findMany.mockResolvedValue([doc({ expirationDate: enDias(60) })]);

    const resumen = await service.barrer(HOY);

    expect(resumen.avisosEnviados).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('un fallo de correo no detiene el resto del barrido', async () => {
    const { service, prisma, notifications } = construir({
      prisma: { membership: { findMany: vi.fn().mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]) } },
      email: { send: vi.fn().mockRejectedValueOnce(new Error('SMTP caído')).mockResolvedValue(undefined) },
    });
    prisma.assetDocument.findMany.mockResolvedValue([doc()]);

    const resumen = await service.barrer(HOY);

    expect(resumen.errores).toBe(1);
    expect(resumen.avisosEnviados).toBe(1);   // el segundo destinatario sí recibió
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('la preferencia de correo apagada no cancela la notificación en la app', async () => {
    const { service, prisma, notifications, email } = construir({
      prisma: {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            email: 'admin@gmt.cl',
            preferences: { notifyEmail: false },
          }),
        },
      },
    });
    prisma.assetDocument.findMany.mockResolvedValue([doc()]);

    const resumen = await service.barrer(HOY);

    expect(email.send).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(resumen.avisosEnviados).toBe(1);
  });

  it('sin destinatarios no revienta y lo deja registrado', async () => {
    // Es sintoma de que el rol no esta asignado, no de que todo este al dia.
    const { service, prisma, notifications } = construir({
      prisma: { membership: { findMany: vi.fn().mockResolvedValue([]) } },
    });
    prisma.assetDocument.findMany.mockResolvedValue([doc()]);

    const resumen = await service.barrer(HOY);

    expect(resumen.destinatarios).toBe(0);
    expect(resumen.avisosEnviados).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('busca solo documentos APROBADOS de VEHICULOS con vencimiento', async () => {
    const { service, prisma } = construir();
    await service.barrer(HOY);

    const where = prisma.assetDocument.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APROBADO');
    expect(where.asset.type).toBe('VEHICULO');
    expect(where.expirationDate).toEqual({ not: null });
  });

  it('los destinatarios se resuelven por PERMISO, no por nombre de rol', async () => {
    // Si mañana otro rol recibe asset:manage:fleet, sus miembros deben quedar
    // incluidos sin tocar este código (ADR-0001).
    const { service, prisma } = construir();
    await service.barrer(HOY);

    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { permission: { key: 'asset:manage:fleet' } } }),
    );
  });

  it('renovar el documento limpia sus avisos para que el ciclo empiece de cero', async () => {
    const { service, prisma } = construir();
    await service.limpiarAvisosDe('doc-1');
    expect(prisma.assetDocumentExpiryNotice.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
  });
});
