import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { EmailService } from '../../src/common/email.service';
import type { OtpService } from '../../src/common/otp.service';
import { ProfileService } from '../../src/modules/profile/profile.service';
import { hashPassword, verifyPassword } from '../../src/common/password';
import type { UpdateProfileDto } from '../../src/modules/profile/dto/update-profile.dto';
import type { ChangePasswordDto } from '../../src/modules/profile/dto/change-password.dto';
import type { ChangeEmailRequestDto } from '../../src/modules/profile/dto/change-email-request.dto';
import type { ChangeEmailConfirmDto } from '../../src/modules/profile/dto/change-email-confirm.dto';

/** Forma del User (con memberships) que devuelve Prisma en estos tests. */
interface FakeUserRow {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  emailInstitucionalVerified: Date | null;
  emailPersonalVerified: Date | null;
  pendingEmail: string | null;
  pendingEmailKind: 'INSTITUCIONAL' | 'PERSONAL' | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  status: string;
  points: number;
  isClientUser: boolean;
  memberships: Array<{ roleKey: string; scopeType: string; scopeId: string }>;
}

function baseUser(overrides: Partial<FakeUserRow> = {}): FakeUserRow {
  return {
    id: 'me-1',
    firstName: 'Ana',
    secondName: 'María',
    lastName: 'Pérez',
    secondLastName: 'Soto',
    email: 'ana@gmt.cl',
    emailInstitucional: 'ana@gmt.cl',
    emailPersonal: null,
    emailInstitucionalVerified: new Date('2026-07-01T00:00:00.000Z'),
    emailPersonalVerified: null,
    pendingEmail: null,
    pendingEmailKind: null,
    avatarUrl: null,
    passwordHash: null,
    status: 'ACTIVE',
    points: 10,
    isClientUser: false,
    memberships: [
      { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      { roleKey: 'viewer', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
    ],
    ...overrides,
  };
}

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

interface BuildOpts {
  findUser?: FakeUserRow | null;
  updateImpl?: (args: UpdateArgs) => Promise<FakeUserRow>;
  findFirst?: { id: string } | null;
  otpGenerate?: () => Promise<string>;
  otpVerify?: () => Promise<boolean>;
}

/** Construye un ProfileService con mocks tipados de Prisma + OtpService + EmailService. */
function buildService(opts: BuildOpts = {}): {
  service: ProfileService;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  otpGenerate: ReturnType<typeof vi.fn>;
  otpVerify: ReturnType<typeof vi.fn>;
  emailSend: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn(() => Promise.resolve(opts.findUser ?? null));
  const update = vi.fn(
    opts.updateImpl ??
      ((args: UpdateArgs): Promise<FakeUserRow> =>
        Promise.resolve({ ...baseUser({ id: args.where.id }), ...args.data })),
  );
  const findFirst = vi.fn(() => Promise.resolve(opts.findFirst ?? null));
  const otpGenerate = vi.fn(opts.otpGenerate ?? (() => Promise.resolve('123456')));
  const otpVerify = vi.fn(opts.otpVerify ?? (() => Promise.resolve(true)));
  const emailSend = vi.fn(() => Promise.resolve());

  const prisma = { user: { findUnique, update, findFirst } } as unknown as PrismaService;
  const otp = { generate: otpGenerate, verify: otpVerify } as unknown as OtpService;
  const email = { send: emailSend } as unknown as EmailService;

  return {
    service: new ProfileService(prisma, otp, email),
    findUnique,
    update,
    findFirst,
    otpGenerate,
    otpVerify,
    emailSend,
  };
}

describe('ProfileService.getMe', () => {
  it('retorna el perfil propio con roleKeys ORG y campos de correo/verificación', async () => {
    const { service } = buildService({ findUser: baseUser() });

    const result = await service.getMe('me-1');

    expect(result).toEqual({
      id: 'me-1',
      firstName: 'Ana',
      secondName: 'María',
      lastName: 'Pérez',
      secondLastName: 'Soto',
      email: 'ana@gmt.cl',
      emailInstitucional: 'ana@gmt.cl',
      emailPersonal: null,
      emailInstitucionalVerified: true,
      emailPersonalVerified: false,
      pendingEmail: null,
      pendingEmailKind: null,
      avatarUrl: null,
      status: 'ACTIVE',
      isClientUser: false,
      roleKeys: ['operator', 'viewer'],
    });
  });

  it('mapea verified como boolean (timestamp != null) y expone el pending', async () => {
    const { service } = buildService({
      findUser: baseUser({
        emailPersonal: 'ana@gmail.com',
        emailPersonalVerified: new Date('2026-07-05T00:00:00.000Z'),
        emailInstitucionalVerified: null,
        pendingEmail: 'nueva@gmt.cl',
        pendingEmailKind: 'INSTITUCIONAL',
      }),
    });

    const result = await service.getMe('me-1');

    expect(result.emailInstitucionalVerified).toBe(false);
    expect(result.emailPersonalVerified).toBe(true);
    expect(result.pendingEmail).toBe('nueva@gmt.cl');
    expect(result.pendingEmailKind).toBe('INSTITUCIONAL');
  });

  it('lanza 404 si el usuario de la sesión ya no existe', async () => {
    const { service } = buildService({ findUser: null });
    await expect(service.getMe('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProfileService.updateMe', () => {
  it('actualiza SOLO el propio usuario (where.id = userId del controller, no del body)', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', { firstName: 'Anita' } as UpdateProfileDto);

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.where).toEqual({ id: 'me-1' });
  });

  it('NO permite cambiar email, status, roles ni points: el data solo lleva campos editables', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    const dirty = {
      firstName: 'Anita',
      avatarUrl: 'https://cdn.gmt.cl/a.png',
      email: 'hacker@evil.cl',
      status: 'SUSPENDED',
      points: 9999,
      roleKeys: ['org_admin'],
      id: 'otro-usuario',
    } as unknown as UpdateProfileDto;

    await service.updateMe('me-1', dirty);

    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data).toEqual({ firstName: 'Anita', avatarUrl: 'https://cdn.gmt.cl/a.png' });
    expect(arg.data).not.toHaveProperty('email');
    expect(arg.data).not.toHaveProperty('status');
    expect(arg.data).not.toHaveProperty('points');
    expect(arg.data).not.toHaveProperty('roleKeys');
    expect(arg.data).not.toHaveProperty('id');
  });

  it('normaliza string vacío a null en secondName/secondLastName/avatarUrl (limpiar campo)', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', {
      secondName: '',
      secondLastName: '',
      avatarUrl: '',
    } as UpdateProfileDto);

    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data).toEqual({ secondName: null, secondLastName: null, avatarUrl: null });
  });

  it('un DTO vacío no escribe ningún campo (data = {})', async () => {
    const { service, update } = buildService({ findUser: baseUser() });

    await service.updateMe('me-1', {} as UpdateProfileDto);

    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data).toEqual({});
  });

  it('traduce P2025 (registro no encontrado) a 404', async () => {
    const { service } = buildService({
      updateImpl: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });

    await expect(service.updateMe('ghost', { firstName: 'X' } as UpdateProfileDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProfileService.requestEmailChange', () => {
  const dto: ChangeEmailRequestDto = {
    newEmail: 'nueva@gmt.cl',
    kind: 'INSTITUCIONAL' as ChangeEmailRequestDto['kind'],
  };

  it('registra el pending, genera OTP para el nuevo correo y lo envía SIN revelar el código', async () => {
    const { service, update, otpGenerate, emailSend } = buildService({ findUser: baseUser() });

    const res = await service.requestEmailChange('me-1', dto);

    expect(res).toEqual({ ok: true });
    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.where).toEqual({ id: 'me-1' });
    expect(arg.data).toEqual({ pendingEmail: 'nueva@gmt.cl', pendingEmailKind: 'INSTITUCIONAL' });

    expect(otpGenerate).toHaveBeenCalledWith('nueva@gmt.cl', 'CHANGE_EMAIL');
    const sent = emailSend.mock.calls[0]?.[0] as { to: string; subject: string; body: string };
    expect(sent.to).toBe('nueva@gmt.cl');
    // El código va SOLO en el cuerpo del correo, jamás en la respuesta del endpoint.
    expect(sent.body).toContain('123456');
    expect(JSON.stringify(res)).not.toContain('123456');
  });

  it('recorta espacios del nuevo correo antes de persistir/generar', async () => {
    const { service, update, otpGenerate } = buildService({ findUser: baseUser() });

    await service.requestEmailChange('me-1', {
      newEmail: '  nueva@gmt.cl  ',
      kind: 'PERSONAL' as ChangeEmailRequestDto['kind'],
    });

    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data).toEqual({ pendingEmail: 'nueva@gmt.cl', pendingEmailKind: 'PERSONAL' });
    expect(otpGenerate).toHaveBeenCalledWith('nueva@gmt.cl', 'CHANGE_EMAIL');
  });

  it('409 si el nuevo correo ya lo usa OTRO usuario (colisión), sin generar OTP', async () => {
    const { service, findFirst, update, otpGenerate } = buildService({
      findUser: baseUser(),
      findFirst: { id: 'otro-usuario' },
    });

    await expect(service.requestEmailChange('me-1', dto)).rejects.toBeInstanceOf(ConflictException);
    // La colisión excluye al propio usuario del match.
    const where = findFirst.mock.calls[0]?.[0]?.where as { id: { not: string } };
    expect(where.id).toEqual({ not: 'me-1' });
    expect(update).not.toHaveBeenCalled();
    expect(otpGenerate).not.toHaveBeenCalled();
  });

  it('404 si el usuario de la sesión ya no existe', async () => {
    const { service } = buildService({ findUser: null });
    await expect(service.requestEmailChange('ghost', dto)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProfileService.confirmEmailChange', () => {
  const dto: ChangeEmailConfirmDto = { code: '123456' };

  it('aplica el correo INSTITUCIONAL verificado, limpia el pending y recomputa el email primario', async () => {
    const { service, update, otpVerify } = buildService({
      findUser: baseUser({
        emailInstitucional: null,
        emailInstitucionalVerified: null,
        email: 'ana@personal.cl',
        emailPersonal: 'ana@personal.cl',
        emailPersonalVerified: new Date('2026-07-02T00:00:00.000Z'),
        pendingEmail: 'ana@gmt.cl',
        pendingEmailKind: 'INSTITUCIONAL',
      }),
    });

    const result = await service.confirmEmailChange('me-1', dto);

    expect(otpVerify).toHaveBeenCalledWith('ana@gmt.cl', 'CHANGE_EMAIL', '123456');
    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data.emailInstitucional).toBe('ana@gmt.cl');
    expect(arg.data.emailInstitucionalVerified).toBeInstanceOf(Date);
    expect(arg.data.pendingEmail).toBeNull();
    expect(arg.data.pendingEmailKind).toBeNull();
    // Primario recomputado = emailInstitucional ?? emailPersonal → el nuevo institucional.
    expect(arg.data.email).toBe('ana@gmt.cl');
    expect(result.emailInstitucionalVerified).toBe(true);
    expect(result.pendingEmail).toBeNull();
  });

  it('al agregar un correo PERSONAL, conserva "al menos un correo": el primario sigue siendo el institucional', async () => {
    const { service, update } = buildService({
      findUser: baseUser({
        emailInstitucional: 'ana@gmt.cl',
        emailInstitucionalVerified: new Date('2026-07-01T00:00:00.000Z'),
        email: 'ana@gmt.cl',
        emailPersonal: null,
        pendingEmail: 'ana@gmail.com',
        pendingEmailKind: 'PERSONAL',
      }),
    });

    const result = await service.confirmEmailChange('me-1', dto);

    const arg = update.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.data.emailPersonal).toBe('ana@gmail.com');
    expect(arg.data.emailPersonalVerified).toBeInstanceOf(Date);
    // Primario = institucional ?? personal → se mantiene el institucional (no queda sin correo).
    expect(arg.data.email).toBe('ana@gmt.cl');
    expect(result.email).toBe('ana@gmt.cl');
  });

  it('400 si no hay cambio de correo pendiente', async () => {
    const { service, otpVerify } = buildService({
      findUser: baseUser({ pendingEmail: null, pendingEmailKind: null }),
    });

    await expect(service.confirmEmailChange('me-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(otpVerify).not.toHaveBeenCalled();
  });

  it('propaga el error del OTP inválido y NO persiste', async () => {
    const { service, update } = buildService({
      findUser: baseUser({ pendingEmail: 'nueva@gmt.cl', pendingEmailKind: 'INSTITUCIONAL' }),
      otpVerify: () => Promise.reject(new BadRequestException('Código OTP incorrecto.')),
    });

    await expect(service.confirmEmailChange('me-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('409 si al persistir colisiona el unique (P2002) por carrera con otro usuario', async () => {
    const { service } = buildService({
      findUser: baseUser({ pendingEmail: 'nueva@gmt.cl', pendingEmailKind: 'INSTITUCIONAL' }),
      updateImpl: () => Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
    });

    await expect(service.confirmEmailChange('me-1', dto)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ProfileService.requestPasswordChange', () => {
  it('envía el OTP al institucional cuando está verificado', async () => {
    const { service, otpGenerate, emailSend } = buildService({
      findUser: baseUser({
        emailInstitucional: 'ana@gmt.cl',
        emailInstitucionalVerified: new Date('2026-07-01T00:00:00.000Z'),
        emailPersonal: 'ana@gmail.com',
        emailPersonalVerified: new Date('2026-07-02T00:00:00.000Z'),
      }),
    });

    const res = await service.requestPasswordChange('me-1');

    expect(res).toEqual({ ok: true });
    expect(otpGenerate).toHaveBeenCalledWith('ana@gmt.cl', 'CHANGE_PASSWORD');
    expect((emailSend.mock.calls[0]?.[0] as { to: string }).to).toBe('ana@gmt.cl');
  });

  it('cae al personal verificado si el institucional no está verificado', async () => {
    const { service, otpGenerate } = buildService({
      findUser: baseUser({
        emailInstitucional: 'ana@gmt.cl',
        emailInstitucionalVerified: null,
        emailPersonal: 'ana@gmail.com',
        emailPersonalVerified: new Date('2026-07-02T00:00:00.000Z'),
      }),
    });

    await service.requestPasswordChange('me-1');

    expect(otpGenerate).toHaveBeenCalledWith('ana@gmail.com', 'CHANGE_PASSWORD');
  });

  it('cae al email primario si ningún correo está verificado', async () => {
    const { service, otpGenerate } = buildService({
      findUser: baseUser({
        email: 'ana@gmt.cl',
        emailInstitucional: 'ana@gmt.cl',
        emailInstitucionalVerified: null,
        emailPersonal: 'ana@gmail.com',
        emailPersonalVerified: null,
      }),
    });

    await service.requestPasswordChange('me-1');

    expect(otpGenerate).toHaveBeenCalledWith('ana@gmt.cl', 'CHANGE_PASSWORD');
  });
});

describe('ProfileService.changePassword (endurecido)', () => {
  async function userWithPassword(plain: string): Promise<FakeUserRow> {
    return baseUser({ passwordHash: await hashPassword(plain) });
  }

  it('con contraseña actual + OTP válidos, hashea y persiste la nueva (round-trip bcrypt)', async () => {
    const findUser = await userWithPassword('current123');
    const { service, update, otpVerify } = buildService({ findUser });

    const dto: ChangePasswordDto = {
      currentPassword: 'current123',
      newPassword: 'newpass123',
      code: '123456',
    };
    const result = await service.changePassword('me-1', dto);

    expect(result).toEqual({ ok: true });
    // OTP verificado contra el destino resuelto (institucional verificado en baseUser).
    expect(otpVerify).toHaveBeenCalledWith('ana@gmt.cl', 'CHANGE_PASSWORD', '123456');
    const arg = update.mock.calls[0]?.[0] as { where: { id: string }; data: { passwordHash: string } };
    expect(arg.where).toEqual({ id: 'me-1' });
    await expect(verifyPassword('newpass123', arg.data.passwordHash)).resolves.toBe(true);
  });

  it('401 si la contraseña actual no coincide: no verifica OTP ni persiste', async () => {
    const findUser = await userWithPassword('otra-distinta');
    const { service, update, otpVerify } = buildService({ findUser });

    await expect(
      service.changePassword('me-1', {
        currentPassword: 'current123',
        newPassword: 'newpass123',
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(otpVerify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('401 si el usuario aún no tiene passwordHash', async () => {
    const { service, update } = buildService({ findUser: baseUser({ passwordHash: null }) });

    await expect(
      service.changePassword('me-1', {
        currentPassword: 'current123',
        newPassword: 'newpass123',
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('propaga el error del OTP inválido y NO persiste la nueva contraseña', async () => {
    const findUser = await userWithPassword('current123');
    const { service, update } = buildService({
      findUser,
      otpVerify: () => Promise.reject(new BadRequestException('Código OTP incorrecto.')),
    });

    await expect(
      service.changePassword('me-1', {
        currentPassword: 'current123',
        newPassword: 'newpass123',
        code: '000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('404 si el usuario de la sesión ya no existe', async () => {
    const { service } = buildService({ findUser: null });
    await expect(
      service.changePassword('ghost', {
        currentPassword: 'current123',
        newPassword: 'newpass123',
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
