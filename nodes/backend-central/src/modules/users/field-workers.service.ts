import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateFieldWorkerInput, FieldWorker } from '@gmt-platform/contracts';

/**
 * Trabajadores de faena: la gente que va a terreno.
 *
 * Se guardan en la misma tabla que los usuarios, pero sin acceso: sin clave
 * (`passwordHash` null, y el login ya rechaza una cuenta sin hash), sin rol y
 * sin relación en OpenFGA. No reciben credenciales porque no hay ninguna que
 * recibir. `isFieldWorker` los separa de los usuarios de verdad en todos los
 * listados: donde se elige "un usuario" se está eligiendo a alguien con cuenta.
 *
 * El correo y el nombre de usuario se inventan porque la tabla los exige únicos.
 * El dominio es `.invalid`, que la RFC 2606 reserva justamente para direcciones
 * que no deben resolver: así ningún correo sale por accidente hacia una casilla
 * de alguien y queda evidente que la ficha no es una cuenta.
 */

const DOMINIO_SIN_CUENTA = 'trabajador.invalid';

/** Cuántos sufijos se prueban antes de rendirse con un nombre muy repetido. */
const MAX_INTENTOS_USUARIO = 60;

@Injectable()
export class FieldWorkersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todos los trabajadores de faena, con en cuántas tareas están asignados. */
  async list(search?: string): Promise<FieldWorker[]> {
    const termino = search?.trim();
    const workers = await this.prisma.user.findMany({
      where: {
        isFieldWorker: true,
        ...(termino
          ? {
              OR: [
                { firstName: { contains: termino, mode: 'insensitive' } },
                { lastName: { contains: termino, mode: 'insensitive' } },
                { cargo: { contains: termino, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        cargo: true,
        _count: { select: { crewMemberships: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return workers.map((w) => ({
      id: w.id,
      firstName: w.firstName,
      lastName: w.lastName,
      cargo: w.cargo,
      assignments: w._count.crewMemberships,
    }));
  }

  async create(input: CreateFieldWorkerInput): Promise<FieldWorker> {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName) {
      throw new BadRequestException('El trabajador necesita nombre y apellido.');
    }

    const username = await this.usernameLibre(firstName, lastName);
    const worker = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        username,
        email: `${username}@${DOMINIO_SIN_CUENTA}`,
        cargo: input.cargo?.trim() || null,
        isFieldWorker: true,
        // Sin clave no hay forma de entrar. El estado queda en el de una cuenta
        // nunca usada, que es literalmente lo que es.
        passwordHash: null,
        status: 'PENDING_FIRST_LOGIN',
      },
      select: { id: true, firstName: true, lastName: true, cargo: true },
    });

    return { ...worker, assignments: 0 };
  }

  async update(id: string, input: Partial<CreateFieldWorkerInput>): Promise<FieldWorker> {
    await this.assertEsTrabajador(id);
    const data: Prisma.UserUpdateInput = {};
    if (input.firstName !== undefined) {
      const v = input.firstName.trim();
      if (!v) throw new BadRequestException('El nombre no puede quedar vacío.');
      data.firstName = v;
    }
    if (input.lastName !== undefined) {
      const v = input.lastName.trim();
      if (!v) throw new BadRequestException('El apellido no puede quedar vacío.');
      data.lastName = v;
    }
    if (input.cargo !== undefined) data.cargo = input.cargo?.trim() || null;

    const worker = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        cargo: true,
        _count: { select: { crewMemberships: true } },
      },
    });
    return {
      id: worker.id,
      firstName: worker.firstName,
      lastName: worker.lastName,
      cargo: worker.cargo,
      assignments: worker._count.crewMemberships,
    };
  }

  /**
   * Borra la ficha. Sus asignaciones a cuadrillas caen con ella (cascada), así
   * que se avisa cuántas son: quitar a alguien de la lista maestra no debería
   * vaciar en silencio la cuadrilla de media obra.
   */
  async remove(id: string, forzar: boolean): Promise<{ removed: true; assignments: number }> {
    const worker = await this.assertEsTrabajador(id);
    const assignments = await this.prisma.taskWorker.count({ where: { userId: id } });
    if (assignments > 0 && !forzar) {
      throw new BadRequestException(
        `${worker.firstName} ${worker.lastName} está en ${assignments} ${
          assignments === 1 ? 'tarea' : 'tareas'
        }. Confirma para quitarlo de todas.`,
      );
    }
    await this.prisma.user.delete({ where: { id } });
    return { removed: true, assignments };
  }

  private async assertEsTrabajador(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, firstName: true, lastName: true, isFieldWorker: true },
    });
    if (!user) throw new NotFoundException('El trabajador no existe.');
    // Un usuario con cuenta NO se edita ni se borra por esta puerta: acá no hay
    // gestión de roles, sesiones ni OpenFGA, y saltarse eso dejaría basura.
    if (!user.isFieldWorker) {
      throw new BadRequestException('Esa persona tiene cuenta en GMT Link; edítala en Usuarios.');
    }
    return user;
  }

  /**
   * Nombre de usuario libre a partir del nombre: inicial + apellido, sin tildes
   * ni espacios. Se prueba con sufijo numérico hasta encontrar uno libre; el
   * `@unique` de la tabla cubre la carrera entre dos altas simultáneas.
   */
  private async usernameLibre(firstName: string, lastName: string): Promise<string> {
    const limpiar = (v: string): string =>
      v
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, '')
        .replace(/[^a-zA-Z]/gu, '')
        .toLowerCase();

    const base =
      `${limpiar(firstName).slice(0, 1)}${limpiar(lastName)}`.slice(0, 24) || 'trabajador';
    for (let i = 0; i < MAX_INTENTOS_USUARIO; i += 1) {
      const intento = i === 0 ? base : `${base}${i + 1}`;
      const tomado = await this.prisma.user.findUnique({
        where: { username: intento },
        select: { id: true },
      });
      if (!tomado) return intento;
    }
    throw new BadRequestException(
      'Hay demasiados trabajadores con ese nombre. Agrega el segundo apellido para distinguirlo.',
    );
  }
}
