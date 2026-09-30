import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ProjectDocumentStatus, ScopeType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { StorageService } from '../../common/storage/storage.service';

import {
  CreateAssignmentDto,
  CreateProjectDto,
  CreateServiceDto,
  UpdateAssignmentDto,
  UpdateProjectDto,
  UpdateProjectKpisDto,
  UpdateServiceFrequencyDto,
} from './dto/projects.dto';
import type { ProjectDashboard } from '@gmt-platform/contracts';
import { computeProjectDashboard, type DashboardActivity } from './dashboard.util';
import { ClimaService } from './clima.service';
import { hashPassword, verifyPassword } from '../../common/password';
import { signObraPass, verifyObraPass } from '../../common/jwt';
import { computeObraDashboard, type ObraActivity, type ObraDashboard } from './obra-dashboard.util';
import { computeControlSemanal } from './control-semanal.util';
import { avanceSemanal } from './avance-ponderado.util';
import { EditarAvanceActividadDto, EditarCorteDto, EditarSemanaDto } from './dto/avance.dto';
import { resolveFreshFileUrl } from '../../common/storage/fresh-file-url.util';
import type {
  AvanceObraEditable,
  ObraDashboard as ObraDashboardView,
  TaskCrewMember,
} from '@gmt-platform/contracts';

/** Carpeta del storage donde viven las fotos de terreno de los cercos. */
const CARPETA_FOTOS_CERCO = 'cercos';

/**
 * Qué documento de una tarea cuenta como FOTO del cerco. Lo usan el tablero
 * (para mostrarla) y `quitarFotoCerco` (para borrarla): si discreparan, quitar
 * la foto podría borrar el PDF de un plano colgado del mismo cerco.
 */
const ES_FOTO: Prisma.ProjectDocumentWhereInput = {
  OR: [
    { fileUrl: { endsWith: '.jpg', mode: 'insensitive' } },
    { fileUrl: { endsWith: '.jpeg', mode: 'insensitive' } },
    { fileUrl: { endsWith: '.png', mode: 'insensitive' } },
    { fileUrl: { endsWith: '.webp', mode: 'insensitive' } },
  ],
};

/**
 * Saca los NOMBRES de la cuadrilla del tablero público, dejando la cuenta.
 *
 * El enlace público se comparte con el cliente y hoy los proyectos están sin
 * clave: quién trabaja en cada cerco es dato personal de un trabajador y no
 * tiene por qué viajar ahí. "Cuadrilla de 4" informa lo mismo para lo que el
 * tablero sirve —dónde está la gente— sin publicar a nadie.
 */
function anonimizarCuadrilla(dashboard: ObraDashboardView): ObraDashboardView {
  return {
    ...dashboard,
    map: {
      ...dashboard.map,
      points: dashboard.map.points.map((p) => ({ ...p, crew: [] })),
    },
  };
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly clima: ClimaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Crea un proyecto. Registra el proyecto en Postgres y crea una Membership
   * para el creador del proyecto con el rol `project_creator`, sincronizándolo a FGA.
   */
  async create(userId: string, dto: CreateProjectDto) {
    // La faena es OBLIGATORIA: de su `code` deriva el código autogenerado del
    // proyecto y su cliente debe coincidir con el del proyecto.
    const faena = await this.prisma.faena.findUnique({ where: { id: dto.faenaId } });
    if (!faena) {
      throw new BadRequestException('La faena indicada no existe.');
    }
    if (faena.clientId !== dto.clientId) {
      throw new BadRequestException('La faena no pertenece al cliente del proyecto.');
    }
    if (dto.projectAdminId) {
      const admin = await this.prisma.user.findUnique({
        where: { id: dto.projectAdminId },
        select: { id: true },
      });
      if (!admin) {
        throw new BadRequestException('El administrador de proyecto indicado no existe.');
      }
    }

    // Código autogenerado `${faena.code}-${n}` con `n` correlativo por faena.
    // Se ignora cualquier `code` del input. `@@unique([faenaId, code])` cubre
    // la concurrencia.
    const code = await this.nextProjectCode(dto.faenaId, faena.code);

    const created = this.prisma.$transaction(async (tx) => {
      // 1. Crear el proyecto
      const project = await tx.project.create({
        data: {
          code,
          name: dto.name,
          description: dto.description ?? null,
          clientId: dto.clientId,
          contractNumber: dto.contractNumber ?? null,
          projectType: dto.projectType ?? null,
          faenaId: dto.faenaId,
          projectAdminId: dto.projectAdminId ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          kpis: {},
        },
      });

      // 2. Crear la membresía de project_creator para el creador
      await tx.membership.create({
        data: {
          userId,
          roleKey: 'project_creator',
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
      });

      // 3. Sincronizar membresía a OpenFGA
      await this.fga.syncMembershipToFGA(
        {
          userId,
          roleKey: 'project_creator',
          scopeType: ScopeType.PROJECT,
          scopeId: project.id,
        },
        'create',
      );

      // 4. Escribir relaciones estructurales en OpenFGA. La tupla de
      //    departamento solo se escribe si el proyecto tiene departamento
      //    (ya no se asigna en la creación; queda por si alguna fila lo tuviera).
      const tuples = [
        {
          user: `client:${project.clientId}`,
          relation: 'client',
          object: `project:${project.id}`,
        },
      ];
      if (project.departmentId) {
        tuples.unshift({
          user: `department:${project.departmentId}`,
          relation: 'department',
          object: `project:${project.id}`,
        });
      }
      await this.fga.writeTuples(tuples);

      return this.injectCurrentKpi(project);
    });

    try {
      return await created;
    } catch (error) {
      // `@@unique([faenaId, code])`: dos creaciones simultáneas en la misma faena
      // pueden calcular el mismo `n`. El segundo insert choca (P2002) → 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'No se pudo asignar el código del proyecto por una creación simultánea. Intenta nuevamente.',
        );
      }
      throw error;
    }
  }

  /**
   * Próximo código de proyecto dentro de una faena: `${faenaCode}-${n}`. Toma
   * los proyectos de la faena cuyo `code` empieza con `${faenaCode}-`, parsea el
   * sufijo numérico tras el último `-`, toma el máximo y suma 1. Sin proyectos → 1.
   */
  private async nextProjectCode(faenaId: string, faenaCode: string): Promise<string> {
    const prefix = `${faenaCode}-`;
    const projects = await this.prisma.project.findMany({
      where: { faenaId },
      select: { code: true },
    });

    let maxN = 0;
    for (const { code } of projects) {
      if (!code.startsWith(prefix)) continue;
      const suffix = code.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      const n = Number.parseInt(suffix, 10);
      if (n > maxN) maxN = n;
    }

    return `${faenaCode}-${maxN + 1}`;
  }

  /**
   * Lista todos los proyectos.
   * Filtra por visibilidad:
   *  - Si es org_admin, ve todos.
   *  - Si no, ve proyectos donde tenga membresía directa (PROJECT) o indirecta (DEPARTMENT).
   */
  async listAll(userId: string, faenaId?: string) {
    // 1. Verificar si es administrador global
    const globalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    if (globalAdmin) {
      const projects = await this.prisma.project.findMany({
        where: faenaId ? { faenaId } : {},
        include: {
          department: true,
          client: true,
          services: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return this.injectCurrentKpiBatch(projects);
    }

    // 2. Si no es admin global, leer sus membresías de proyecto y departamento
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        scopeType: { in: [ScopeType.PROJECT, ScopeType.DEPARTMENT] },
      },
    });

    const projectIds = memberships
      .filter((m) => m.scopeType === ScopeType.PROJECT)
      .map((m) => m.scopeId);

    const departmentIds = memberships
      .filter((m) => m.scopeType === ScopeType.DEPARTMENT)
      .map((m) => m.scopeId);

    const accessClause = {
      OR: [{ id: { in: projectIds } }, { departmentId: { in: departmentIds } }],
    };
    const projects = await this.prisma.project.findMany({
      // Solo envolvemos en AND cuando hay filtro por faena; sin filtro,
      // la cláusula de acceso queda tal cual (evita cambiar la forma del where).
      where: faenaId ? { AND: [accessClause, { faenaId }] } : accessClause,
      include: {
        department: true,
        client: true,
        services: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.injectCurrentKpiBatch(projects);
  }

  /**
   * Obtiene un proyecto por ID y valida acceso con OpenFGA.
   */
  /**
   * Dashboard de producción del proyecto: consolida las actividades (Tasks) por
   * SERVICIO y calcula avance real (ponderado por `estimatedPoints`), avance
   * proyectado (por `dueDate`), curvas acumuladas, y término programado vs.
   * estimado por ritmo real. La autorización la da el guard `can_view` del
   * endpoint. Lee datos REALES; hoy puede venir vacío si no hay actividades.
   */
  async getDashboard(projectId: string): Promise<ProjectDashboard> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }

    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      select: {
        status: true,
        estimatedPoints: true,
        startDate: true,
        dueDate: true,
        completedAt: true,
        serviceId: true,
        service: { select: { name: true } },
      },
    });

    // Agrupación por servicio; las tareas sin servicio caen a "Sin servicio".
    // Las fases cuelgan de un servicio (Phase.serviceId), así que agrupar por
    // servicio ya consolida también lo organizado por fase.
    const activities: DashboardActivity[] = tasks.map((t) => ({
      groupId: t.serviceId ?? 'sin-servicio',
      groupName: t.service?.name ?? 'Sin servicio',
      status: t.status,
      weight: t.estimatedPoints,
      startDate: t.startDate,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
    }));

    return computeProjectDashboard(project.id, project.name, 'SERVICE', activities, new Date());
  }

  /**
   * Dashboard de avance de OBRA. A diferencia de `getDashboard`, que mide avance
   * binario ponderado por esfuerzo, este mide avance FÍSICO por cantidad
   * (dados, ml de zanja) contra la carta Gantt. Es el que se proyecta en faena.
   */
  async getObraDashboard(projectId: string): Promise<ObraDashboard> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, client: { select: { name: true } } },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }
    return this.buildObraDashboard(project.id, project.name, project.client?.name ?? null);
  }

  /**
   * Mismo dashboard, resuelto por el token público del proyecto y SIN sesión:
   * es lo que se abre en la TV de faena y lo que se comparte con el cliente.
   * El token opaco es la única credencial, igual que en la ficha de vehículos.
   *
   * Expone SOLO avance físico, hitos y fechas. Nada de costos, nombres de
   * personas ni datos internos: quien tiene el link no tiene por qué verlos.
   */
  async getPublicObraDashboard(
    token: string,
    credencial: { pase?: string; sesionAutorizada?: boolean } = {},
  ): Promise<ObraDashboard> {
    const project = await this.prisma.project.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        name: true,
        publicPasswordHash: true,
        client: { select: { name: true } },
      },
    });
    // El proyecto con clave solo abre con el pase de la clave o con una sesión
    // de GMT Link que ya tenga permiso de ver el proyecto.
    if (project?.publicPasswordHash) {
      // Se verifica siempre, venga o no: uno ausente no pasa la firma. Así la
      // decisión depende del resultado de la verificación y no de lo que el
      // cliente eligió mandar.
      const conPase = verifyObraPass(credencial.pase ?? '', token);
      if (!conPase && !credencial.sesionAutorizada) {
        throw new UnauthorizedException('Este tablero pide clave o iniciar sesión.');
      }
    }
    // Anti-enumeración: un token inválido responde igual que uno inexistente.
    if (!project) {
      throw new NotFoundException('El dashboard no existe o el enlace ya no es válido.');
    }
    const dashboard = await this.buildObraDashboard(
      project.id,
      project.name,
      project.client?.name ?? null,
    );
    return anonimizarCuadrilla(dashboard);
  }

  /**
   * ¿Este usuario ya puede ver el proyecto que hay detrás del token público?
   * Sirve para que quien tiene sesión en GMT Link entre al tablero protegido
   * sin escribir la clave. Devuelve `false` ante cualquier duda.
   */
  async puedeVerPorToken(token: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { publicToken: token },
      select: { id: true },
    });
    if (!project) return false;
    try {
      return await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_view',
        object: `project:${project.id}`,
      });
    } catch {
      // Si el servicio de autorización no responde, se pide la clave. Fallar
      // cerrado: nunca abrir un tablero protegido porque OpenFGA está caído.
      return false;
    }
  }

  /**
   * Fija o quita la clave del enlace público. `null` deja el enlace abierto.
   * La clave se guarda hasheada: el enlace se comparte con el cliente y una
   * clave en claro en base sería un regalo.
   */
  async setPublicPassword(
    projectId: string,
    password: string | null,
  ): Promise<{ publicPasswordSet: boolean }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('El proyecto no existe.');

    const hash = password === null ? null : await hashPassword(password);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { publicPasswordHash: hash },
    });
    return { publicPasswordSet: hash !== null };
  }

  /**
   * Canjea la clave del enlace por un pase de jornada. Responde igual ante
   * token inexistente y clave incorrecta: quien prueba enlaces al azar no debe
   * poder distinguir "no existe" de "existe pero erré la clave".
   */
  async unlockPublicDashboard(token: string, password: string): Promise<{ pass: string }> {
    const project = await this.prisma.project.findUnique({
      where: { publicToken: token },
      select: { publicPasswordHash: true },
    });
    const hash = project?.publicPasswordHash ?? null;
    const correcta = hash !== null && (await verifyPassword(password, hash));
    if (!correcta) {
      throw new UnauthorizedException('La clave no es correcta.');
    }
    return { pass: signObraPass(token) };
  }

  /** Carga las actividades del proyecto y delega el cálculo al util puro. */
  private async buildObraDashboard(
    id: string,
    name: string,
    clientName: string | null,
  ): Promise<ObraDashboard> {
    // El control por HH y el avance físico se leen en paralelo: son fuentes
    // distintas de la misma obra y el tablero las muestra juntas.
    const [control, semanas, actividades, cuadrilla, fotos] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id },
        select: { totalHh: true, cutoffDate: true, planAtCutoff: true },
      }),
      this.prisma.projectWeek.findMany({ where: { projectId: id }, orderBy: { index: 'asc' } }),
      this.prisma.projectActivity.findMany({ where: { projectId: id }, orderBy: { wbsId: 'asc' } }),
      // Cuadrilla asignada a cada tarea de la obra. El jefe va primero.
      this.prisma.taskWorker.findMany({
        where: { task: { projectId: id } },
        select: {
          taskId: true,
          lead: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              cargo: true,
              isFieldWorker: true,
            },
          },
        },
        orderBy: [{ lead: 'desc' }, { createdAt: 'asc' }],
      }),
      // Foto de avance del área: el documento de imagen más nuevo colgado de
      // la tarea. Mientras nadie suba una, el mapa muestra la vista satelital.
      this.prisma.projectDocument.findMany({
        where: {
          projectId: id,
          taskId: { not: null },
          ...ES_FOTO,
        },
        select: { taskId: true, fileUrl: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const tasks = await this.prisma.task.findMany({
      where: { projectId: id },
      select: {
        id: true,
        name: true,
        type: true,
        unit: true,
        quantityTotal: true,
        latitude: true,
        longitude: true,
        startDate: true,
        dueDate: true,
        earlyStart: true,
        earlyFinish: true,
        lateStart: true,
        lateFinish: true,
        serviceId: true,
        parentId: true,
        service: { select: { id: true, name: true } },
        progress: { select: { id: true, date: true, quantity: true }, orderBy: { date: 'asc' } },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });

    const activities: ObraActivity[] = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      phaseId: t.service?.id ?? 'sin-fase',
      phaseName: t.service?.name ?? 'Sin fase',
      unit: t.unit,
      quantityTotal: t.quantityTotal,
      isMilestone: t.type === 'HITO',
      start: t.startDate,
      end: t.dueDate,
      earlyStart: t.earlyStart,
      earlyFinish: t.earlyFinish,
      lateStart: t.lateStart,
      lateFinish: t.lateFinish,
      parentId: t.parentId,
      lat: t.latitude,
      lng: t.longitude,
      progress: t.progress.map((r) => ({ id: r.id, date: r.date, quantity: r.quantity })),
    }));

    const controlSemanal = computeControlSemanal(
      {
        totalHh: control?.totalHh ?? null,
        cutoffDate: control?.cutoffDate ?? null,
        planAtCutoff: control?.planAtCutoff ?? null,
      },
      semanas,
      actividades,
    );

    // Todas las fotos por tarea, de la más nueva a la más vieja: el tablero
    // elige cuál corresponde a la semana que se esté mirando.
    //
    // `fileUrl` guarda la CLAVE del storage, no una URL: se firma al leer. Pasar
    // la clave tal cual dejaba la imagen rota en el mapa.
    const urls = await Promise.all(fotos.map((d) => resolveFreshFileUrl(this.storage, d.fileUrl)));
    const porTarea = new Map<string, Array<{ url: string; date: string }>>();
    for (const [i, d] of fotos.entries()) {
      if (!d.taskId) continue;
      const lista = porTarea.get(d.taskId) ?? [];
      lista.push({ url: urls[i] ?? d.fileUrl, date: d.createdAt.toISOString().slice(0, 10) });
      porTarea.set(d.taskId, lista);
    }

    const porTareaCuadrilla = new Map<string, TaskCrewMember[]>();
    for (const m of cuadrilla) {
      const lista = porTareaCuadrilla.get(m.taskId) ?? [];
      lista.push({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        cargo: m.user.cargo,
        lead: m.lead,
        fieldWorker: m.user.isFieldWorker,
      });
      porTareaCuadrilla.set(m.taskId, lista);
    }

    const dashboard = computeObraDashboard(id, name, activities, new Date(), {
      semanas: semanas.map((w) => w.closeDate),
      // `lastClosed` es un índice; como cantidad de semanas informadas es +1.
      informadas: (controlSemanal?.lastClosed ?? -1) + 1,
      fotos: porTarea,
      cuadrillas: porTareaCuadrilla,
    });

    // El clima se pide en el centro de los cercos ubicados: es donde está la
    // cuadrilla. Si el proyecto no tiene ubicaciones, no hay dónde consultar.
    const puntos = dashboard.map.points;
    const weather =
      puntos.length > 0
        ? await this.clima.enPunto(
            puntos.reduce((s, p) => s + p.lat, 0) / puntos.length,
            puntos.reduce((s, p) => s + p.lng, 0) / puntos.length,
          )
        : null;

    return { ...dashboard, clientName, weather, control: controlSemanal };
  }

  async getById(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        department: true,
        client: true,
        // Incluye el tipo de servicio (Tanda 4) para mostrar tipo + procedimientos.
        services: { include: { serviceType: true } },
      },
    });

    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }

    // Check visibility via OpenFGA (project can_view relation)
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view',
      object: `project:${projectId}`,
    });

    if (!allowed) {
      throw new NotFoundException('El proyecto no existe o no tienes acceso.');
    }

    return this.injectCurrentKpi(project);
  }

  /**
   * Crea un servicio dentro del proyecto ELIGIENDO UN TIPO del catálogo (Tanda 4).
   * El código corto (§7) se deriva del código del tipo (único por proyecto: prueba
   * sufijos numéricos ante colisión) y `docCodingConfig` toma el default de firma de
   * cliente del tipo. El nombre por defecto es el del tipo (o el que pase el usuario).
   */
  async createService(projectId: string, dto: CreateServiceDto, userId: string) {
    // Validar acceso para modificar proyecto
    const canCreate = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_create_service',
      object: `project:${projectId}`,
    });
    if (!canCreate) {
      throw new BadRequestException('No tienes permisos para crear servicios en este proyecto.');
    }

    const serviceType = await this.prisma.serviceType.findUnique({
      where: { id: dto.serviceTypeId },
    });
    if (!serviceType) {
      throw new BadRequestException('El tipo de servicio no existe.');
    }
    if (!serviceType.isActive) {
      throw new BadRequestException('El tipo de servicio está desactivado.');
    }

    const name = dto.name?.trim() || serviceType.name;
    const code = await this.deriveServiceCode(projectId, serviceType.code);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const service = await tx.service.create({
          data: {
            code,
            name,
            projectId,
            serviceTypeId: serviceType.id,
            frequency: dto.frequency ?? null,
            docCodingConfig: { requiresClientSignature: serviceType.requiresClientSignature },
          },
        });

        await this.fga.writeTuples([
          {
            user: `project:${projectId}`,
            relation: 'project',
            object: `service:${service.id}`,
          },
        ]);

        return service;
      });
    } catch (error) {
      // Carrera: dos creaciones simultáneas del mismo tipo derivan el mismo código
      // (deriveServiceCode escanea fuera de la transacción) y chocan con
      // @@unique([projectId, code]). El índice protege la integridad; devolvemos un
      // 409 amigable en vez de un 500 genérico.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'No se pudo asignar el código del servicio por una creación simultánea. Vuelve a intentarlo.',
        );
      }
      throw error;
    }
  }

  /**
   * Deriva un código de servicio único DENTRO del proyecto a partir del código del
   * tipo. Si el código base ya está tomado, prueba `BASE2`, `BASE3`, … El código es
   * un segmento del código de documento (§7); se conserva estable en el servicio (no
   * se recalcula si luego cambia el tipo).
   */
  private async deriveServiceCode(projectId: string, typeCode: string): Promise<string> {
    const base = typeCode.toUpperCase();
    const rows = await this.prisma.service.findMany({
      where: { projectId },
      select: { code: true },
    });
    const taken = new Set(rows.map((r) => r.code));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base}${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Improbable: 1000 servicios del mismo tipo en un proyecto.
    return `${base}${taken.size + 1}`;
  }

  /**
   * Configura los KPIs de un proyecto (JSONB).
   */
  async updateKpis(projectId: string, dto: UpdateProjectKpisDto, userId: string) {
    const canDefine = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_define_kpi',
      object: `project:${projectId}`,
    });
    if (!canDefine) {
      throw new BadRequestException('No tienes permisos para definir KPIs en este proyecto.');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { kpis: dto.kpis },
    });
    return this.injectCurrentKpi(updated);
  }

  /**
   * Actualización GENERAL del proyecto (solo `name`/`description` en este corte).
   * NO toca la faena ni las claves estructurales (clientId/code/FGA). El gate de
   * `project:update` lo pone el controller.
   */
  async updateGeneral(projectId: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) {
      throw new NotFoundException('El proyecto no existe.');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name,
        description: dto.description,
      },
    });
    return this.injectCurrentKpi(updated);
  }

  /**
   * Elimina un proyecto. Solo procede si está "limpio": sin servicios, tareas,
   * documentos, elementos, trabajadores asignados ni activos. Si tiene contenido,
   * responde 409 con el detalle de lo que bloquea. La membresía `project_creator`
   * autocreada NO cuenta como bloqueante (se limpia junto al proyecto).
   * Al borrar: sincroniza la baja en OpenFGA (membresías de proyecto + tuplas
   * estructurales de cliente/departamento), borra las membresías de scope PROJECT
   * y el proyecto en una sola transacción. El gate de `project:delete` lo pone el
   * controller.
   */
  async remove(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        _count: {
          select: {
            services: true,
            tasks: true,
            documents: true,
            elements: true,
            workers: true,
            overtimeRequests: true,
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }

    // Los activos tienen `projectId` opcional (onDelete: SetNull), así que no
    // vienen en el _count por relación: se cuentan aparte.
    const assetCount = await this.prisma.asset.count({ where: { projectId } });

    const blockers: string[] = [];
    if (project._count.services > 0) blockers.push(`${project._count.services} servicio(s)`);
    if (project._count.tasks > 0) blockers.push(`${project._count.tasks} tarea(s)`);
    if (project._count.documents > 0) blockers.push(`${project._count.documents} documento(s)`);
    if (project._count.elements > 0) blockers.push(`${project._count.elements} elemento(s)`);
    if (project._count.workers > 0)
      blockers.push(`${project._count.workers} trabajador(es) asignado(s)`);
    if (project._count.overtimeRequests > 0)
      blockers.push(`${project._count.overtimeRequests} solicitud(es) de horas extra`);
    if (assetCount > 0) blockers.push(`${assetCount} activo(s)`);

    if (blockers.length > 0) {
      throw new ConflictException(`No puedes eliminar el proyecto: tiene ${blockers.join(', ')}.`);
    }

    // Membresías de scope PROJECT del proyecto (incluye la autocreada
    // `project_creator`): se sincroniza su baja en FGA y se borran en la misma
    // transacción. Los errores de FGA no deben abortar el borrado local.
    const memberships = await this.prisma.membership.findMany({
      where: { scopeType: ScopeType.PROJECT, scopeId: projectId },
    });

    // Tuplas estructurales escritas al crear (cliente + departamento si lo hubiera).
    const structuralTuples = [
      { user: `client:${project.clientId}`, relation: 'client', object: `project:${projectId}` },
    ];
    if (project.departmentId) {
      structuralTuples.push({
        user: `department:${project.departmentId}`,
        relation: 'department',
        object: `project:${projectId}`,
      });
    }

    // Solo Postgres dentro de la transacción. Si entre el conteo y el delete se
    // agregó un hijo con FK Restrict (p.ej. un servicio), Postgres lanza P2003:
    // se mapea al mismo 409 que clientes/faenas (carrera TOCTOU).
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.membership.deleteMany({
          where: { scopeType: ScopeType.PROJECT, scopeId: projectId },
        });
        await tx.project.delete({ where: { id: projectId } });
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'No puedes eliminar el proyecto: se le agregó contenido mientras se eliminaba. Vuelve a intentarlo.',
        );
      }
      throw error;
    }

    // La sincronización de la baja en FGA va DESPUÉS del commit (OpenFGA no es
    // transaccional ni idempotente): si el borrado local falla, FGA no se toca.
    // Los fallos se registran, no abortan (el proyecto ya no existe en Postgres).
    for (const membership of memberships) {
      await this.fga
        .syncMembershipToFGA(
          {
            userId: membership.userId,
            roleKey: membership.roleKey,
            scopeType: ScopeType.PROJECT,
            scopeId: projectId,
          },
          'delete',
        )
        .catch((error: unknown) =>
          this.logger.error(
            `No se pudo sincronizar la baja FGA de la membresía del proyecto ${projectId} (usuario ${membership.userId}).`,
            error instanceof Error ? error.stack : String(error),
          ),
        );
    }
    await this.fga
      .deleteTuples(structuralTuples)
      .catch((error: unknown) =>
        this.logger.error(
          `No se pudieron borrar las tuplas estructurales FGA del proyecto ${projectId}.`,
          error instanceof Error ? error.stack : String(error),
        ),
      );

    return { success: true };
  }

  /**
   * Obtiene todos los departamentos disponibles.
   */
  async listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Obtiene todos los clientes disponibles.
   */
  async listClients() {
    return this.prisma.client.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Usuarios elegibles como administrador de proyecto.
   * Se listan los usuarios internos ACTIVOS (no usuarios de cliente): el admin
   * de proyecto es un rol interno de GMT. El gate de acceso al endpoint lo pone
   * el controller (project:create).
   */
  async listEligibleAdmins() {
    return this.prisma.user.findMany({
      where: { isClientUser: false, status: { not: 'SUSPENDED' } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /** Setea la frecuencia de un servicio del proyecto. */
  async setServiceFrequency(projectId: string, serviceId: string, dto: UpdateServiceFrequencyDto) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.projectId !== projectId) {
      throw new NotFoundException('El servicio no existe en este proyecto.');
    }
    return this.prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
      },
    });
  }

  /**
   * Borra un servicio del proyecto. NO bloquea: las actividades y los documentos
   * cuelgan del PROYECTO, así que se DESVINCULAN del servicio (su `serviceId`
   * queda en null y siguen en el proyecto). Solo se eliminan las fases y sus datos
   * capturados, que sí son propios del servicio. No se pierde ninguna actividad ni
   * documento.
   */
  async deleteService(projectId: string, serviceId: string): Promise<{ ok: true }> {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.projectId !== projectId) {
      throw new NotFoundException('El servicio no existe en este proyecto.');
    }
    await this.prisma.service.delete({ where: { id: serviceId } });
    return { ok: true };
  }

  // ── Control de avance de obra (project:progress:manage) ────────────────────

  /**
   * Los datos crudos del control, para editarlos en la pestaña "Avance".
   *
   * Trae el calculado AL LADO del efectivo: con una sobreescritura puesta, la
   * pantalla tiene que poder mostrar cuánto se aparta de lo que dicen las
   * actividades. Una segunda fuente que no se ve es la que se desincroniza.
   */
  async getAvanceEditable(projectId: string, userId: string): Promise<AvanceObraEditable> {
    const [proyecto, semanas, actividades, puedeEditar] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { totalHh: true, cutoffDate: true, planAtCutoff: true },
      }),
      this.prisma.projectWeek.findMany({ where: { projectId }, orderBy: { index: 'asc' } }),
      this.prisma.projectActivity.findMany({
        where: { projectId },
        orderBy: { wbsId: 'asc' },
        select: { wbsId: true, name: true, phase: true, hh: true, realByWeek: true },
      }),
      // La MISMA consulta que hace el guard de los PATCH. Resolverlo por otro
      // camino (p. ej. `PermissionService.can`, que además mira los grants del
      // rol) podría abrir celdas que después el guard rechaza, o al revés.
      this.fga.check({
        user: `user:${userId}`,
        relation: 'can_manage_progress',
        object: `project:${projectId}`,
      }),
    ]);
    if (!proyecto) {
      throw new NotFoundException('El proyecto no existe.');
    }

    const calculado = avanceSemanal(actividades, Math.max(0, semanas.length - 1));
    return {
      puedeEditar,
      cutoffDate: proyecto.cutoffDate ? proyecto.cutoffDate.toISOString().slice(0, 10) : null,
      planAtCutoff: proyecto.planAtCutoff,
      totalHh: proyecto.totalHh,
      semanas: semanas.map((w) => {
        // Mismo desplazamiento que `recalcularAvance`: S-0 es el arranque.
        const calc = w.index >= 1 ? calculado[w.index - 1] : { acm: 0, par: 0 };
        return {
          code: w.code,
          index: w.index,
          closeDate: w.closeDate.toISOString().slice(0, 10),
          hhPlan: w.hhPlan,
          parPlan: w.parPlan,
          acmPlan: w.acmPlan,
          parReal: w.parReal,
          acmReal: w.acmReal,
          parRealCalculado: calc?.par ?? null,
          acmRealCalculado: calc?.acm ?? null,
          parRealOverride: w.parRealOverride,
          acmRealOverride: w.acmRealOverride,
        };
      }),
      actividades,
    };
  }

  /** Fecha de corte del informe vigente y el plan a esa fecha. */
  async editarCorte(projectId: string, dto: EditarCorteDto): Promise<void> {
    const fecha = new Date(`${dto.cutoffDate}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) {
      throw new BadRequestException('La fecha de corte no es válida.');
    }
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        cutoffDate: fecha,
        ...(dto.planAtCutoff !== undefined ? { planAtCutoff: dto.planAtCutoff } : {}),
      },
    });
  }

  /**
   * Recalcula `parReal`/`acmReal` de TODAS las semanas del proyecto.
   *
   * El valor efectivo es el calculado desde las actividades, salvo que la
   * semana tenga sobreescritura: ahí manda la sobreescritura. Guardar el
   * efectivo en las columnas de siempre deja el tablero intacto (no sabe que
   * existe este cálculo) y mantiene UN solo número consultable.
   *
   * Se recalcula entero y no solo la semana tocada porque el acumulado de una
   * semana arrastra a las siguientes: cambiar S-2 mueve S-3 en adelante.
   */
  private async recalcularAvance(projectId: string): Promise<void> {
    const [actividades, semanas] = await Promise.all([
      this.prisma.projectActivity.findMany({
        where: { projectId },
        select: { hh: true, realByWeek: true },
      }),
      this.prisma.projectWeek.findMany({
        where: { projectId },
        orderBy: { index: 'asc' },
        select: { id: true, index: true, parRealOverride: true, acmRealOverride: true },
      }),
    ]);
    if (semanas.length === 0) return;

    // S-0 es el arranque y no tiene actividades detrás: el cálculo por
    // actividad empieza en S-1, así que se desplaza un lugar.
    const calculado = avanceSemanal(actividades, Math.max(0, semanas.length - 1));

    await this.prisma.$transaction(
      semanas.map((semana) => {
        const desde = semana.index - 1;
        const calc = desde >= 0 ? calculado[desde] : { acm: 0, par: 0 };
        return this.prisma.projectWeek.update({
          where: { id: semana.id },
          data: {
            parReal: semana.parRealOverride ?? calc?.par ?? null,
            acmReal: semana.acmRealOverride ?? calc?.acm ?? null,
          },
        });
      }),
    );
  }

  /**
   * Avance acumulado de UNA actividad en UNA semana.
   *
   * `realByWeek` no admite huecos: su largo dice hasta qué semana hay informe.
   * Si la semana editada cae más adelante que el largo actual, las intermedias
   * se rellenan con el último acumulado conocido —no con cero—, porque lo ya
   * ejecutado no se deshace por no haberlo informado.
   */
  async editarAvanceActividad(projectId: string, dto: EditarAvanceActividadDto): Promise<void> {
    const actividad = await this.prisma.projectActivity.findFirst({
      where: { projectId, wbsId: dto.wbsId },
      select: { id: true, realByWeek: true },
    });
    if (!actividad) {
      throw new NotFoundException('La actividad no existe en este proyecto.');
    }

    const real = [...actividad.realByWeek];
    const ultimo = real.length > 0 ? (real[real.length - 1] ?? 0) : 0;
    while (real.length <= dto.semana) real.push(ultimo);
    real[dto.semana] = dto.valor;

    await this.prisma.projectActivity.update({
      where: { id: actividad.id },
      data: { realByWeek: real },
    });
    await this.recalcularAvance(projectId);
  }

  /**
   * Plan o sobreescritura del real de una semana.
   *
   * Pasar `null` en una sobreescritura la QUITA y devuelve el valor calculado.
   * Es la vía de vuelta: sin ella, un número mal tecleado quedaría pegado para
   * siempre tapando el cálculo.
   */
  async editarSemana(projectId: string, dto: EditarSemanaDto): Promise<void> {
    const semana = await this.prisma.projectWeek.findFirst({
      where: { projectId, code: dto.code },
      select: { id: true, index: true },
    });
    if (!semana) {
      throw new NotFoundException(`La semana ${dto.code} no existe en este proyecto.`);
    }

    // Quitar una sobreescritura es volver al calculado. Si la semana no tiene
    // detalle por actividad no HAY calculado: quedaría vacía y el tablero
    // perdería un informe firmado.
    if (dto.parRealOverride === null || dto.acmRealOverride === null) {
      const actividades = await this.prisma.projectActivity.findMany({
        where: { projectId },
        select: { hh: true, realByWeek: true },
      });
      const calc =
        semana.index >= 1 ? avanceSemanal(actividades, semana.index)[semana.index - 1] : { acm: 0 };
      if (calc?.acm === null || calc === undefined) {
        throw new BadRequestException(
          `${dto.code} no tiene detalle por actividad: no hay valor calculado al que volver. ` +
            'Carga el avance de las actividades de esa semana o corrige el valor a mano.',
        );
      }
    }

    // Solo las claves que vinieron: `undefined` significa "no se tocó", que es
    // distinto de `null` ("quitar la sobreescritura").
    const data: Prisma.ProjectWeekUpdateInput = {};
    if (dto.hhPlan !== undefined) data.hhPlan = dto.hhPlan;
    if (dto.parPlan !== undefined) data.parPlan = dto.parPlan;
    if (dto.acmPlan !== undefined) data.acmPlan = dto.acmPlan;
    if (dto.parRealOverride !== undefined) data.parRealOverride = dto.parRealOverride;
    if (dto.acmRealOverride !== undefined) data.acmRealOverride = dto.acmRealOverride;

    if (Object.keys(data).length === 0) return;

    await this.prisma.projectWeek.update({ where: { id: semana.id }, data });
    await this.recalcularAvance(projectId);
  }

  /**
   * Foto de terreno de un cerco.
   *
   * NO hay modelo nuevo: se crea un `ProjectDocument` colgado de la tarea, que
   * es lo que el tablero ya lee para preferir la foto por sobre la vista
   * satelital. Lo que faltaba era una forma cómoda de subirla, no un lugar
   * donde guardarla.
   *
   * La foto va en el CERCO (la tarea padre), que es la clave con la que el
   * tablero las agrupa (`parentId ?? id`).
   */
  async subirFotoCerco(
    projectId: string,
    taskId: string,
    archivo: { buffer: Buffer; originalname: string; mimetype: string },
    userId: string,
  ): Promise<{ url: string }> {
    const tarea = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
      select: { id: true, name: true, parentId: true },
    });
    if (!tarea) {
      throw new NotFoundException('El cerco no existe en este proyecto.');
    }
    if (tarea.parentId !== null) {
      // Una etapa no es un cerco: el tablero agrupa por el padre y la foto
      // colgada de una hija no aparecería donde se espera.
      throw new BadRequestException('La foto va en el cerco, no en una de sus etapas.');
    }
    if (!archivo.mimetype.startsWith('image/')) {
      throw new BadRequestException('La foto debe ser una imagen.');
    }

    const guardado = await this.storage.save({
      buffer: archivo.buffer,
      filename: archivo.originalname,
      contentType: archivo.mimetype,
      folder: CARPETA_FOTOS_CERCO,
    });

    // `code` es único global y obligatorio. Una foto de terreno NO es un
    // entregable codificado (§7): se le da un código legible y evidentemente
    // no controlado, con la marca de tiempo como parte única.
    const ahora = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    const sello =
      `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}` +
      `-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}`;

    await this.prisma.projectDocument.create({
      data: {
        name: `Foto de avance · ${tarea.name}`,
        code: `FOTO-${tarea.id.slice(-6)}-${sello}`,
        fileUrl: guardado.key,
        // BORRADOR y no PENDIENTE_QA: una foto del sitio no pasa por revisión
        // de calidad, y meterla en esa cola ensuciaría el trabajo de QA.
        status: ProjectDocumentStatus.BORRADOR,
        projectId,
        taskId: tarea.id,
        ownerId: userId,
      },
    });
    return { url: guardado.url };
  }

  /**
   * Quita la foto MÁS NUEVA de un cerco, que es la que el tablero muestra.
   *
   * No borra el historial: las fotos anteriores siguen ahí y el tablero vuelve
   * a mostrar la que corresponda. Si no queda ninguna, vuelve la satelital.
   */
  async quitarFotoCerco(projectId: string, taskId: string): Promise<{ quedan: number }> {
    const fotos = await this.prisma.projectDocument.findMany({
      where: { projectId, taskId, ...ES_FOTO },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileUrl: true },
    });
    const ultima = fotos[0];
    if (!ultima) {
      throw new NotFoundException('Este cerco no tiene fotos.');
    }

    await this.prisma.projectDocument.delete({ where: { id: ultima.id } });
    // El archivo se borra best-effort: que quede huérfano en el storage es
    // mucho menos grave que dejar el registro apuntando a la nada.
    try {
      await this.storage.delete(ultima.fileUrl);
    } catch (error) {
      this.logger.warn(`No se pudo borrar la foto "${ultima.fileUrl}": ${String(error)}`);
    }
    return { quedan: fotos.length - 1 };
  }

  // ── Asignación de trabajadores a proyecto ──────────────────────────────────

  async listAssignments(projectId: string) {
    await this.assertProjectExists(projectId);
    return this.prisma.projectWorkerAssignment.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Asigna un trabajador al proyecto (persistencia en Postgres).
   * TODO(FGA): materializar la tupla funcional del rol asignado sobre el
   * proyecto (p. ej. (user:U, operator, project:P)) cuando se defina el mapeo
   * roleKey→relación FGA de trabajadores. Por ahora la autorización de acceso
   * a datos se resuelve vía Membership/roles existentes.
   */
  async createAssignment(projectId: string, dto: CreateAssignmentDto) {
    await this.assertProjectExists(projectId);
    await this.assertUserExists(dto.userId);

    const existing = await this.prisma.projectWorkerAssignment.findFirst({
      where: { projectId, userId: dto.userId, roleKey: dto.roleKey },
    });
    if (existing) {
      throw new BadRequestException('El trabajador ya está asignado con ese rol en el proyecto.');
    }

    return this.prisma.projectWorkerAssignment.create({
      data: {
        projectId,
        userId: dto.userId,
        roleKey: dto.roleKey,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async updateAssignment(projectId: string, assignmentId: string, dto: UpdateAssignmentDto) {
    const assignment = await this.getAssignmentInProject(projectId, assignmentId);

    // El cambio de roleKey no debe colisionar con otra asignación del mismo
    // usuario en el proyecto (@@unique([projectId, userId, roleKey])).
    if (dto.roleKey && dto.roleKey !== assignment.roleKey) {
      const clash = await this.prisma.projectWorkerAssignment.findFirst({
        where: { projectId, userId: assignment.userId, roleKey: dto.roleKey },
      });
      if (clash) {
        throw new BadRequestException('El trabajador ya está asignado con ese rol en el proyecto.');
      }
    }

    return this.prisma.projectWorkerAssignment.update({
      where: { id: assignmentId },
      data: {
        status: dto.status,
        roleKey: dto.roleKey,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async removeAssignment(projectId: string, assignmentId: string) {
    await this.getAssignmentInProject(projectId, assignmentId);
    await this.prisma.projectWorkerAssignment.delete({ where: { id: assignmentId } });
    return { success: true };
  }

  private async getAssignmentInProject(projectId: string, assignmentId: string) {
    const assignment = await this.prisma.projectWorkerAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.projectId !== projectId) {
      throw new NotFoundException('La asignación no existe en este proyecto.');
    }
    return assignment;
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('El proyecto no existe.');
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('El usuario indicado no existe.');
    }
  }

  private async injectCurrentKpi<T extends { id: string; kpis: unknown }>(project: T) {
    if (!project) return project;
    const completedTasksSum = await this.prisma.task.aggregate({
      where: {
        projectId: project.id,
        status: TaskStatus.COMPLETADO,
      },
      _sum: {
        actualPoints: true,
      },
    });
    const current = completedTasksSum._sum.actualPoints || 0;

    return this.withCurrentKpi(project, current);
  }

  /**
   * Igual que `injectCurrentKpi` pero para una LISTA: calcula el KPI `current` de
   * todos los proyectos con UNA sola agregación por lotes (`groupBy` por proyecto)
   * en vez de un `task.aggregate` por proyecto (evita el N+1 del listado). La forma
   * de salida es idéntica: cada proyecto con `kpis.current` inyectado.
   */
  private async injectCurrentKpiBatch<T extends { id: string; kpis: unknown }>(projects: T[]) {
    if (projects.length === 0) return [];
    const sums = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: {
        status: TaskStatus.COMPLETADO,
        projectId: { in: projects.map((p) => p.id) },
      },
      _sum: { actualPoints: true },
    });
    const byProject = new Map(sums.map((s) => [s.projectId, s._sum.actualPoints ?? 0]));
    return projects.map((project) => this.withCurrentKpi(project, byProject.get(project.id) ?? 0));
  }

  /** Inyecta `kpis.current` conservando el resto de KPIs configurados (JSONB). */
  private withCurrentKpi<T extends { kpis: unknown }>(project: T, current: number) {
    const existingKpis =
      typeof project.kpis === 'object' && project.kpis !== null
        ? (project.kpis as Record<string, unknown>)
        : {};

    // El hash de la clave del enlace público NO sale del backend: se reemplaza
    // por un booleano que dice si el enlace está protegido. La bandera solo se
    // agrega si la consulta trajo el campo, para no afirmar "sin clave" en
    // listados que ni siquiera lo seleccionaron.
    const { publicPasswordHash, ...resto } = project as T & { publicPasswordHash?: string | null };
    const traeCampo = Object.hasOwn(project as object, 'publicPasswordHash');

    return {
      ...(resto as T),
      ...(traeCampo ? { publicPasswordSet: publicPasswordHash !== null } : {}),
      kpis: {
        ...existingKpis,
        current,
      },
    };
  }
}
