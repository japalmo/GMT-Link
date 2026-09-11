import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  HrAccreditation,
  HrAlerta,
  HrExam,
  HrHours,
  HrHoursPoint,
  HrInduction,
  HrWorkerRow,
  HrWorkerSummary,
} from '@gmt-platform/contracts';
import { esAlerta, estadoDe, horasEntre, porUrgencia } from './vigencia.util';
import type {
  UpsertAccreditationDto,
  UpsertExamDto,
  UpsertInductionDto,
} from './dto/hr.dto';

/**
 * RRHH: los antecedentes laborales del trabajador y su habilitación para faena.
 *
 * Acá NO se administran roles ni permisos de acceso a la plataforma: eso vive en
 * Usuarios. El cargo es un antecedente laboral y se edita desde RRHH; el rol es
 * una credencial y cambiar de cargo no debe tocarla.
 *
 * Sobre los "requisitos faltantes": el tablero informa lo VENCIDO y lo POR
 * VENCER de lo que esté cargado, y nunca dice que falta algo. No existe todavía
 * una regla que declare qué exige cada cliente o faena, y marcar faltantes sin
 * esa regla sería inventar una obligación.
 */

const FAENA_SELECT = { id: true, code: true, name: true } as const;

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  private fecha(d: Date | null | undefined): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
  }

  // ── Exámenes ──────────────────────────────────────────────────────────────

  async listExams(userId: string, hoy = new Date()): Promise<HrExam[]> {
    const filas = await this.prisma.medicalExam.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }, { issuedAt: 'desc' }],
    });
    return filas.map((e) => ({
      id: e.id,
      userId: e.userId,
      type: e.type,
      issuedAt: this.fecha(e.issuedAt),
      expiresAt: this.fecha(e.expiresAt),
      center: e.center,
      result: e.result,
      fileUrl: e.fileUrl,
      notes: e.notes,
      ...estadoDe(e.expiresAt, hoy),
    }));
  }

  async upsertExam(dto: UpsertExamDto, id?: string): Promise<HrExam> {
    await this.assertUsuario(dto.userId);
    const data = {
      userId: dto.userId,
      type: dto.type.trim(),
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      center: dto.center?.trim() || null,
      result: dto.result ?? null,
      fileUrl: dto.fileUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
    };
    // Se busca por el id de la fila escrita y NO por la primera de la lista: la
    // lista va ordenada por tipo, así que "la primera" era el examen que
    // alfabéticamente iba antes, no el que se acababa de guardar.
    const fila = id
      ? await this.prisma.medicalExam.update({ where: { id }, data })
      : await this.prisma.medicalExam.create({ data });
    const guardado = (await this.listExams(dto.userId)).find((e) => e.id === fila.id);
    if (!guardado) throw new NotFoundException('No se pudo leer el examen guardado.');
    return guardado;
  }

  async removeExam(id: string): Promise<{ removed: true }> {
    await this.prisma.medicalExam.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('El examen no existe.');
    });
    return { removed: true };
  }

  // ── Inducciones ───────────────────────────────────────────────────────────

  async listInductions(userId: string, hoy = new Date()): Promise<HrInduction[]> {
    const filas = await this.prisma.induction.findMany({
      where: { userId },
      include: {
        client: { select: { id: true, name: true } },
        faenas: { include: { faena: { select: FAENA_SELECT } } },
      },
      orderBy: [{ issuedAt: 'desc' }, { name: 'asc' }],
    });
    return filas.map((i) => ({
      id: i.id,
      userId: i.userId,
      clientId: i.clientId,
      clientName: i.client.name,
      name: i.name,
      issuedAt: this.fecha(i.issuedAt),
      expiresAt: this.fecha(i.expiresAt),
      fileUrl: i.fileUrl,
      notes: i.notes,
      faenas: i.faenas.map((f) => f.faena),
      ...estadoDe(i.expiresAt, hoy),
    }));
  }

  async upsertInduction(dto: UpsertInductionDto, id?: string): Promise<HrInduction> {
    await this.assertUsuario(dto.userId);
    const faenaIds = [...new Set(dto.faenaIds ?? [])];

    // Todas las faenas tienen que ser del MISMO cliente de la inducción. Sin
    // esto se podría guardar una inducción de Capstone válida en una faena de
    // Albemarle, que es una afirmación falsa sobre dónde puede entrar alguien.
    if (faenaIds.length > 0) {
      const faenas = await this.prisma.faena.findMany({
        where: { id: { in: faenaIds } },
        select: { id: true, clientId: true, name: true },
      });
      if (faenas.length !== faenaIds.length) {
        throw new BadRequestException('Alguna de las faenas ya no existe.');
      }
      const ajenas = faenas.filter((f) => f.clientId !== dto.clientId);
      if (ajenas.length > 0) {
        throw new BadRequestException(
          `Estas faenas no son del cliente de la inducción: ${ajenas
            .map((f) => f.name)
            .join(', ')}.`,
        );
      }
    }

    const data = {
      userId: dto.userId,
      clientId: dto.clientId,
      name: dto.name.trim(),
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      fileUrl: dto.fileUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
    };

    const guardadaId = await this.prisma.$transaction(async (tx) => {
      const fila = id
        ? await tx.induction.update({ where: { id }, data })
        : await tx.induction.create({ data });
      // Las faenas llegan completas y reemplazan a las anteriores: el cliente
      // manda el estado que quiere y no hay diferencias que reconciliar.
      await tx.inductionFaena.deleteMany({ where: { inductionId: fila.id } });
      if (faenaIds.length > 0) {
        await tx.inductionFaena.createMany({
          data: faenaIds.map((faenaId) => ({ inductionId: fila.id, faenaId })),
        });
      }
      return fila.id;
    });

    const guardada = (await this.listInductions(dto.userId)).find((i) => i.id === guardadaId);
    if (!guardada) throw new NotFoundException('No se pudo leer la inducción guardada.');
    return guardada;
  }

  async removeInduction(id: string): Promise<{ removed: true }> {
    await this.prisma.induction.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('La inducción no existe.');
    });
    return { removed: true };
  }

  // ── Acreditaciones ────────────────────────────────────────────────────────

  async listAccreditations(userId: string, hoy = new Date()): Promise<HrAccreditation[]> {
    const filas = await this.prisma.workerAccreditation.findMany({
      where: { userId },
      include: {
        client: { select: { name: true } },
        faena: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { expiresAt: 'asc' }],
    });
    return filas.map((a) => ({
      id: a.id,
      userId: a.userId,
      clientId: a.clientId,
      clientName: a.client.name,
      faenaId: a.faenaId,
      faenaName: a.faena?.name ?? null,
      status: a.status,
      issuedAt: this.fecha(a.issuedAt),
      expiresAt: this.fecha(a.expiresAt),
      fileUrl: a.fileUrl,
      notes: a.notes,
      ...estadoDe(a.expiresAt, hoy),
    }));
  }

  async upsertAccreditation(
    dto: UpsertAccreditationDto,
    id?: string,
  ): Promise<HrAccreditation> {
    await this.assertUsuario(dto.userId);
    if (dto.faenaId) {
      const faena = await this.prisma.faena.findUnique({
        where: { id: dto.faenaId },
        select: { clientId: true, name: true },
      });
      if (!faena) throw new BadRequestException('La faena no existe.');
      if (faena.clientId !== dto.clientId) {
        throw new BadRequestException(`La faena ${faena.name} no es de ese cliente.`);
      }
    }
    const data = {
      userId: dto.userId,
      clientId: dto.clientId,
      faenaId: dto.faenaId ?? null,
      status: dto.status ?? 'EN_TRAMITE',
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      fileUrl: dto.fileUrl?.trim() || null,
      notes: dto.notes?.trim() || null,
    };
    const fila = id
      ? await this.prisma.workerAccreditation.update({ where: { id }, data })
      : await this.prisma.workerAccreditation.create({ data });
    const guardada = (await this.listAccreditations(dto.userId)).find((a) => a.id === fila.id);
    if (!guardada) throw new NotFoundException('No se pudo leer la acreditación guardada.');
    return guardada;
  }

  async removeAccreditation(id: string): Promise<{ removed: true }> {
    await this.prisma.workerAccreditation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('La acreditación no existe.');
    });
    return { removed: true };
  }

  // ── Horas hombre, desde Operaciones ───────────────────────────────────────

  /**
   * HH del trabajador en un período, sobre los registros de tiempo de las
   * actividades (`task_time_logs`). Es la MISMA fuente que usa Operaciones: no
   * hay carga manual paralela ni un segundo criterio de cálculo.
   *
   * Un período sin actividad devuelve `points` vacío con `entries: 0`, que la
   * pantalla distingue de "no se pudo consultar". Nunca se rellenan días en cero
   * para que el gráfico se vea completo.
   */
  async hours(userId: string, from: string, to: string): Promise<HrHours> {
    const desde = new Date(`${from}T00:00:00.000Z`);
    const hasta = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      throw new BadRequestException('Las fechas del período no son válidas.');
    }
    if (desde > hasta) throw new BadRequestException('La fecha inicial es posterior a la final.');

    const logs = await this.prisma.taskTimeLog.findMany({
      where: { userId, startedAt: { gte: desde, lte: hasta } },
      select: { startedAt: true, endedAt: true },
      orderBy: { startedAt: 'asc' },
    });

    // Las horas se imputan al día en que ARRANCÓ la actividad. Repartir un turno
    // de noche entre dos días daría un gráfico más exacto pero dejaría de cuadrar
    // con lo que Operaciones muestra por actividad, y ahí la comparación es lo
    // que importa.
    const porDia = new Map<string, number>();
    let openEntries = 0;
    for (const l of logs) {
      if (!l.endedAt) openEntries += 1;
      const dia = l.startedAt.toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + horasEntre(l.startedAt, l.endedAt));
    }

    const points: HrHoursPoint[] = [...porDia.entries()]
      .map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      from,
      to,
      points,
      totalHours: Math.round(points.reduce((s, p) => s + p.hours, 0) * 100) / 100,
      entries: logs.length,
      openEntries,
    };
  }

  // ── Resumen y directorio ──────────────────────────────────────────────────

  async summary(userId: string, hoy = new Date()): Promise<HrWorkerSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatarUrl: true,
        cargo: true,
        status: true,
        isFieldWorker: true,
        workSchedule: {
          select: {
            shiftPattern: true,
            dayNight: true,
            workDays: true,
            restDays: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('El trabajador no existe.');

    const [documentos, examenes, inducciones, acreditaciones] = await Promise.all([
      this.prisma.personalDocument.findMany({
        where: { userId },
        select: { id: true, name: true, expiresAt: true },
      }),
      this.listExams(userId, hoy),
      this.listInductions(userId, hoy),
      this.listAccreditations(userId, hoy),
    ]);

    const alertas: HrAlerta[] = [];
    for (const d of documentos) {
      const estado = estadoDe(d.expiresAt, hoy);
      if (esAlerta(estado)) {
        alertas.push({
          tipo: 'DOCUMENTO',
          id: d.id,
          nombre: d.name,
          expiresAt: this.fecha(d.expiresAt),
          clientName: null,
          faenaName: null,
          ...estado,
        });
      }
    }
    for (const e of examenes) {
      if (esAlerta(e)) {
        alertas.push({
          tipo: 'EXAMEN',
          id: e.id,
          nombre: e.type,
          expiresAt: e.expiresAt,
          clientName: null,
          faenaName: null,
          vigencia: e.vigencia,
          diasRestantes: e.diasRestantes,
        });
      }
    }
    for (const i of inducciones) {
      if (esAlerta(i)) {
        alertas.push({
          tipo: 'INDUCCION',
          id: i.id,
          nombre: i.name,
          expiresAt: i.expiresAt,
          clientName: i.clientName,
          faenaName: i.faenas.map((f) => f.name).join(', ') || null,
          vigencia: i.vigencia,
          diasRestantes: i.diasRestantes,
        });
      }
    }
    for (const a of acreditaciones) {
      if (esAlerta(a)) {
        alertas.push({
          tipo: 'ACREDITACION',
          id: a.id,
          nombre: `Acreditación ${a.clientName}`,
          expiresAt: a.expiresAt,
          clientName: a.clientName,
          faenaName: a.faenaName,
          vigencia: a.vigencia,
          diasRestantes: a.diasRestantes,
        });
      }
    }

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      cargo: user.cargo,
      status: user.status,
      isFieldWorker: user.isFieldWorker,
      turno: user.workSchedule,
      accreditations: acreditaciones,
      alertas: alertas.sort(porUrgencia),
      conteos: {
        documentos: documentos.length,
        examenes: examenes.length,
        inducciones: inducciones.length,
      },
    };
  }

  /**
   * Directorio de RRHH: la gente, con la síntesis de su situación.
   *
   * Incluye a los trabajadores de faena (fichas sin cuenta): en RRHH son gente
   * que hay que habilitar igual que cualquiera, y esconderlos dejaría fuera
   * justamente a los que van a terreno.
   */
  async listWorkers(search: string | undefined, hoy = new Date()): Promise<HrWorkerRow[]> {
    const termino = search?.trim();
    const where: Prisma.UserWhereInput = {
      isClientUser: false,
      ...(termino
        ? {
            OR: [
              { firstName: { contains: termino, mode: 'insensitive' } },
              { lastName: { contains: termino, mode: 'insensitive' } },
              { cargo: { contains: termino, mode: 'insensitive' } },
              { email: { contains: termino, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatarUrl: true,
        cargo: true,
        status: true,
        isFieldWorker: true,
        workSchedule: { select: { shiftPattern: true, dayNight: true, workDays: true, restDays: true } },
        documents: { select: { expiresAt: true } },
        medicalExams: { select: { expiresAt: true } },
        inductions: { select: { expiresAt: true } },
        accreditations: {
          select: { expiresAt: true, status: true, client: { select: { name: true } } },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return users.map((u) => {
      let vencidos = 0;
      let porVencer = 0;
      const contar = (expiresAt: Date | null) => {
        const e = estadoDe(expiresAt, hoy);
        if (e.vigencia === 'VENCIDO') vencidos += 1;
        else if (e.vigencia === 'POR_VENCER') porVencer += 1;
      };
      u.documents.forEach((d) => contar(d.expiresAt));
      u.medicalExams.forEach((e) => contar(e.expiresAt));
      u.inductions.forEach((i) => contar(i.expiresAt));
      u.accreditations.forEach((a) => contar(a.expiresAt));

      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatarUrl: u.avatarUrl,
        cargo: u.cargo,
        status: u.status,
        isFieldWorker: u.isFieldWorker,
        turno: resumenTurno(u.workSchedule),
        vencidos,
        porVencer,
        // Solo las VIGENTES: una acreditación en trámite o suspendida no
        // habilita a nadie, y listarla como si habilitara sería el error caro.
        acreditadoEn: [
          ...new Set(
            u.accreditations.filter((a) => a.status === 'VIGENTE').map((a) => a.client.name),
          ),
        ].sort((a, b) => a.localeCompare(b, 'es')),
      };
    });
  }

  private async assertUsuario(userId: string): Promise<void> {
    const existe = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('El trabajador no existe.');
  }
}

/** Turno en una línea: "7x7 día", "Administrativo". `null` sin horario cargado. */
function resumenTurno(
  ws: {
    shiftPattern: string;
    dayNight: string;
    workDays: number | null;
    restDays: number | null;
  } | null,
): string | null {
  if (!ws) return null;
  const jornada = ws.dayNight === 'NOCHE' ? 'noche' : 'día';
  if (ws.shiftPattern === 'ADMINISTRATIVO') return 'Administrativo';
  if (ws.workDays && ws.restDays) return `${ws.workDays}x${ws.restDays} ${jornada}`;
  return `Turno ${jornada}`;
}
