import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PersonalDocument, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  HrAccreditation,
  HrAlerta,
  HrDashboard,
  HrDocument,
  HrExam,
  HrHours,
  HrHoursPoint,
  HrInduction,
  HrPersonPage,
  HrRequirementPage,
  HrRequisitoTipo,
  HrTurnoKey,
  HrVigencia,
  HrWorkerRow,
  HrWorkerSummary,
  TableRequest,
} from '@gmt-platform/contracts';
import { tablePage, tableSkipTake } from '../../common/table-pagination.util';
import { DocumentsService, type DatosDocumentoRrhh } from '../documents/documents.service';
import type { ArchivoDocumento } from '../documents/document-file.util';
import { esAlerta, estadoDe, horasEntre, porUrgencia } from './vigencia.util';
import {
  acreditacionHabilita,
  construirTablero,
  consultaPersonas,
  consultaRequisitos,
  requisitosDe,
  TURNO_LABEL,
  turnoLabel,
  type FiltrosRrhh,
  type FuentePersona,
} from './requisitos.util';
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

const TIPOS_VALIDOS: readonly HrRequisitoTipo[] = ['DOCUMENTO', 'EXAMEN', 'INDUCCION', 'ACREDITACION'];
const VIGENCIAS_VALIDAS: readonly HrVigencia[] = [
  'VIGENTE',
  'POR_VENCER',
  'VENCIDO',
  'SIN_VENCIMIENTO',
  'SIN_FECHA',
];
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  private fecha(d: Date | null | undefined): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
  }

  // ── Personas con todos sus requisitos ─────────────────────────────────────

  /**
   * Una sola consulta con todo lo que decide la situación de cada persona. Los
   * cálculos viven en `requisitos.util`, puros; acá solo se trae el dato.
   */
  private async fuentes(
    where: Prisma.UserWhereInput,
    soloTrabajadores = true,
  ): Promise<FuentePersona[]> {
    const users = await this.prisma.user.findMany({
      where: soloTrabajadores ? { isClientUser: false, ...where } : where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        cargo: true,
        isFieldWorker: true,
        workSchedule: {
          select: { shiftPattern: true, dayNight: true, workDays: true, restDays: true },
        },
        documents: {
          select: {
            id: true,
            type: true,
            name: true,
            issuedAt: true,
            expiresAt: true,
            noExpiry: true,
            status: true,
          },
        },
        medicalExams: {
          select: { id: true, type: true, issuedAt: true, expiresAt: true, noExpiry: true },
        },
        inductions: {
          select: {
            id: true,
            name: true,
            clientId: true,
            issuedAt: true,
            expiresAt: true,
            noExpiry: true,
            client: { select: { name: true } },
            faenas: { select: { faena: { select: { id: true, name: true } } } },
          },
        },
        accreditations: {
          select: {
            id: true,
            clientId: true,
            faenaId: true,
            status: true,
            issuedAt: true,
            expiresAt: true,
            noExpiry: true,
            client: { select: { name: true } },
            faena: { select: { name: true } },
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      cargo: u.cargo,
      isFieldWorker: u.isFieldWorker,
      turno: u.workSchedule,
      documentos: u.documents,
      examenes: u.medicalExams,
      inducciones: u.inductions.map((i) => ({
        id: i.id,
        name: i.name,
        clientId: i.clientId,
        clientName: i.client.name,
        faenas: i.faenas.map((f) => f.faena),
        issuedAt: i.issuedAt,
        expiresAt: i.expiresAt,
        noExpiry: i.noExpiry,
      })),
      acreditaciones: u.accreditations.map((a) => ({
        id: a.id,
        clientId: a.clientId,
        clientName: a.client.name,
        faenaId: a.faenaId,
        faenaName: a.faena?.name ?? null,
        status: a.status,
        issuedAt: a.issuedAt,
        expiresAt: a.expiresAt,
        noExpiry: a.noExpiry,
      })),
    }));
  }

  // ── Tablero y consulta ────────────────────────────────────────────────────

  async dashboard(hoy = new Date()): Promise<HrDashboard> {
    const [personas, faenas, clientes] = await Promise.all([
      this.fuentes({}),
      this.prisma.faena.findMany({
        select: { id: true, name: true, clientId: true, client: { select: { name: true } } },
      }),
      this.prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return construirTablero(
      personas,
      faenas.map((f) => ({ id: f.id, name: f.name, clientId: f.clientId, clientName: f.client.name })),
      clientes,
      hoy,
    );
  }

  async requirementsTable(req: TableRequest): Promise<HrRequirementPage> {
    const filtros = await this.parseFiltros(req.filters, req.search);
    const personas = await this.fuentes({});
    const { filas, personas: people } = consultaRequisitos(
      personas,
      filtros,
      req.sortBy,
      req.sortDir === 'desc' ? 'desc' : 'asc',
      new Date(),
    );
    const { page, pageSize, skip, take } = tableSkipTake(req);
    return { ...tablePage(filas.slice(skip, skip + take), filas.length, page, pageSize), people };
  }

  async peopleTable(req: TableRequest): Promise<HrPersonPage> {
    const filtros = await this.parseFiltros(req.filters, req.search);
    const personas = await this.fuentes({});
    const { filas, requisitos } = consultaPersonas(
      personas,
      filtros,
      req.sortBy,
      req.sortDir === 'desc' ? 'desc' : 'asc',
      new Date(),
    );
    const { page, pageSize, skip, take } = tableSkipTake(req);
    return {
      ...tablePage(filas.slice(skip, skip + take), filas.length, page, pageSize),
      requirements: requisitos,
    };
  }

  /**
   * Filtros del query a filtros del cálculo. Lo que no se reconoce se ignora en
   * vez de reventar: el query string lo arma el navegador y un valor viejo en un
   * enlace compartido no debería dejar la tabla en error.
   */
  private async parseFiltros(
    filters: Record<string, string> | undefined,
    search: string | undefined,
  ): Promise<FiltrosRrhh> {
    const f = filters ?? {};
    const texto = (k: string): string | undefined => {
      const v = f[k];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const lista = <T extends string>(k: string, validos: readonly T[]): T[] | undefined => {
      const v = texto(k);
      if (!v) return undefined;
      const elegidos = v
        .split(',')
        .map((x) => x.trim())
        .filter((x): x is T => (validos as readonly string[]).includes(x));
      return elegidos.length > 0 ? elegidos : undefined;
    };
    const fecha = (k: string): string | undefined => {
      const v = texto(k);
      return v && FECHA_ISO.test(v) ? v : undefined;
    };

    const turno = texto('turno');
    const faenaId = texto('faena');
    let faenaClientId: string | undefined;
    if (faenaId) {
      const faena = await this.prisma.faena.findUnique({
        where: { id: faenaId },
        select: { clientId: true },
      });
      faenaClientId = faena?.clientId;
    }

    return {
      search: search?.trim() || undefined,
      turno: turno && turno in TURNO_LABEL ? (turno as HrTurnoKey) : undefined,
      sinCargo: texto('sinCargo') === '1',
      clientId: texto('cliente'),
      faenaId,
      faenaClientId,
      tipos: lista('tipo', TIPOS_VALIDOS),
      vigencias: lista('vigencia', VIGENCIAS_VALIDAS),
      habilitante: texto('habilitante') === '1',
      desde: fecha('desde'),
      hasta: fecha('hasta'),
    };
  }

  // ── Documentos, cargados por RRHH ─────────────────────────────────────────

  private docView(d: PersonalDocument, hoy = new Date()): HrDocument {
    return {
      id: d.id,
      userId: d.userId,
      type: d.type,
      name: d.name,
      issuedAt: this.fecha(d.issuedAt),
      expiresAt: this.fecha(d.expiresAt),
      noExpiry: d.noExpiry,
      status: d.status,
      hasPrevious: d.previousFileUrl !== null,
      updatedAt: d.updatedAt.toISOString(),
      ...estadoDe(d.expiresAt, hoy, !d.noExpiry),
    };
  }

  async listDocuments(userId: string): Promise<HrDocument[]> {
    await this.assertUsuario(userId);
    const filas = await this.prisma.personalDocument.findMany({
      where: { userId },
      orderBy: [{ expiresAt: 'asc' }, { name: 'asc' }],
    });
    const hoy = new Date();
    return filas.map((d) => this.docView(d, hoy));
  }

  async createDocument(
    userId: string,
    fields: DatosDocumentoRrhh,
    file: ArchivoDocumento,
  ): Promise<HrDocument> {
    await this.assertUsuario(userId);
    return this.docView(await this.documents.createForWorker(userId, fields, file));
  }

  async updateDocument(id: string, fields: Partial<DatosDocumentoRrhh>): Promise<HrDocument> {
    return this.docView(await this.documents.updateForWorker(id, fields));
  }

  async replaceDocumentFile(id: string, file: ArchivoDocumento): Promise<HrDocument> {
    return this.docView(await this.documents.replaceFileForWorker(id, file));
  }

  async removeDocument(id: string): Promise<{ removed: true }> {
    await this.documents.removeForWorker(id);
    return { removed: true };
  }

  documentFileUrl(id: string, previous: boolean): Promise<{ url: string }> {
    return this.documents.fileUrlForWorker(id, previous);
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
      noExpiry: e.noExpiry,
      fileUrl: e.fileUrl,
      notes: e.notes,
      ...estadoDe(e.expiresAt, hoy, !e.noExpiry),
    }));
  }

  async upsertExam(dto: UpsertExamDto, id?: string): Promise<HrExam> {
    await this.assertUsuario(dto.userId);
    const noExpiry = dto.noExpiry ?? false;
    const data = {
      userId: dto.userId,
      type: dto.type.trim(),
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: !noExpiry && dto.expiresAt ? new Date(dto.expiresAt) : null,
      noExpiry,
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
      noExpiry: i.noExpiry,
      fileUrl: i.fileUrl,
      notes: i.notes,
      faenas: i.faenas.map((f) => f.faena),
      ...estadoDe(i.expiresAt, hoy, !i.noExpiry),
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

    const noExpiry = dto.noExpiry ?? false;
    const data = {
      userId: dto.userId,
      clientId: dto.clientId,
      name: dto.name.trim(),
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: !noExpiry && dto.expiresAt ? new Date(dto.expiresAt) : null,
      noExpiry,
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
      noExpiry: a.noExpiry,
      fileUrl: a.fileUrl,
      notes: a.notes,
      ...estadoDe(a.expiresAt, hoy, !a.noExpiry),
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
    const noExpiry = dto.noExpiry ?? false;
    const data = {
      userId: dto.userId,
      clientId: dto.clientId,
      faenaId: dto.faenaId ?? null,
      status: dto.status ?? 'EN_TRAMITE',
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: !noExpiry && dto.expiresAt ? new Date(dto.expiresAt) : null,
      noExpiry,
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

    const [fuente] = await this.fuentes({ id: userId }, false);
    const [acreditaciones] = await Promise.all([this.listAccreditations(userId, hoy)]);

    // Las alertas salen del MISMO aplanado que la tabla del tablero: si cada
    // vista decidiera por su cuenta qué está vencido, el resumen y el tablero
    // podrían contradecirse sobre la misma persona.
    const alertas: HrAlerta[] = (fuente ? requisitosDe(fuente, hoy) : [])
      .filter(esAlerta)
      .map((r) => ({
        tipo: r.tipo,
        id: r.id,
        nombre: r.nombre,
        expiresAt: r.expiresAt,
        clientName: r.clientName,
        faenaName: r.faenas,
        vigencia: r.vigencia,
        diasRestantes: r.diasRestantes,
      }))
      .sort(porUrgencia);

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
      alertas,
      conteos: {
        documentos: fuente?.documentos.length ?? 0,
        examenes: fuente?.examenes.length ?? 0,
        inducciones: fuente?.inducciones.length ?? 0,
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
    const personas = await this.fuentes(
      termino
        ? {
            OR: [
              { firstName: { contains: termino, mode: 'insensitive' } },
              { lastName: { contains: termino, mode: 'insensitive' } },
              { cargo: { contains: termino, mode: 'insensitive' } },
              { email: { contains: termino, mode: 'insensitive' } },
            ],
          }
        : {},
    );
    const extras = await this.prisma.user.findMany({
      where: { id: { in: personas.map((p) => p.id) } },
      select: { id: true, avatarUrl: true, status: true },
    });
    const porId = new Map(extras.map((e) => [e.id, e]));

    return personas.map((p) => {
      const filas = requisitosDe(p, hoy);
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        avatarUrl: porId.get(p.id)?.avatarUrl ?? null,
        cargo: p.cargo,
        status: porId.get(p.id)?.status ?? 'ACTIVE',
        isFieldWorker: p.isFieldWorker,
        turno: turnoLabel(p.turno),
        vencidos: filas.filter((r) => r.vigencia === 'VENCIDO').length,
        porVencer: filas.filter((r) => r.vigencia === 'POR_VENCER').length,
        // Solo las que habilitan HOY: vigentes para el cliente y no vencidas.
        acreditadoEn: [
          ...new Set(
            p.acreditaciones
              .filter((a) =>
                acreditacionHabilita(a.status, estadoDe(a.expiresAt, hoy, !a.noExpiry).vigencia),
              )
              .map((a) => a.clientName),
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
