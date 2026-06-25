import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ProjectDocumentStatus, ScopeType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FgaService } from '../../fga/fga.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateProjectDocumentDto } from './dto/project-documents.dto';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

@Injectable()
export class ProjectDocumentsService {
  private readonly logger = new Logger(ProjectDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Genera el código único del documento siguiendo el formato:
   * GMT-{Cliente}-{Depto}-{Proyecto}-{Servicio}-{TipoDoc}-{Area}-{No}
   */
  private async generateDocumentCode(
    projectId: string,
    serviceId: string,
    documentType: string,
    areaCode: string,
  ): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true, department: true },
    });
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!project || !service) {
      throw new BadRequestException('Proyecto o Servicio no válido.');
    }

    const clientCode = project.client.code.toUpperCase();
    const deptCode = project.department.code.toUpperCase();
    const projCode = project.code.toUpperCase();
    const srvCode = service.code.toUpperCase();
    const docType = documentType.toUpperCase();
    const area = areaCode.toUpperCase();

    // Contar documentos similares para generar el correlativo
    const prefix = `GMT-${clientCode}-${deptCode}-${projCode}-${srvCode}-${docType}-${area}`;
    
    // Contar cuántos documentos con este prefijo existen
    const count = await this.prisma.projectDocument.count({
      where: {
        code: { startsWith: prefix },
      },
    });

    let serial = count + 1;
    let code = `${prefix}-${String(serial).padStart(3, '0')}`;

    // Validar unicidad (en caso de que se hayan borrado documentos intermedios)
    let exists = await this.prisma.projectDocument.findUnique({ where: { code } });
    while (exists) {
      serial += 1;
      code = `${prefix}-${String(serial).padStart(3, '0')}`;
      exists = await this.prisma.projectDocument.findUnique({ where: { code } });
    }

    return code;
  }

  /**
   * Sube y registra un nuevo documento en estado PENDIENTE_QA.
   */
  async create(
    userId: string,
    dto: CreateProjectDocumentDto,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    // 1. Validar acceso del usuario al proyecto
    const allowed = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_view',
      object: `project:${dto.projectId}`,
    });
    if (!allowed) {
      throw new BadRequestException('No tienes acceso a este proyecto.');
    }

    // 2. Generar el código del documento
    const code = await this.generateDocumentCode(
      dto.projectId,
      dto.serviceId,
      dto.documentType,
      dto.areaCode,
    );

    // 2.5 Estampar el archivo PDF con metadatos oficiales y marca de agua
    let finalBuffer = file.buffer;
    if (file.mimetype === 'application/pdf') {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
        include: { client: true },
      });
      const dateStr = new Date().toLocaleDateString('es-CL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      finalBuffer = await this.stampDocumentPdf(file.buffer, {
        code,
        revision: 'rev0', // Inicial es rev0
        projectName: project?.name || 'S/N',
        clientName: project?.client?.name || 'S/C',
        date: dateStr,
      });
    }

    // 3. Subir archivo a R2/Storage
    const folder = `projects/${dto.projectId}/documents`;
    const saved = await this.storage.save({
      buffer: finalBuffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder,
    });

    // 4. Calcular Hash SHA-256 para FES
    const fileHash = createHash('sha256').update(finalBuffer).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      // Crear registro en Postgres
      const doc = await tx.projectDocument.create({
        data: {
          name: dto.name,
          code,
          fileUrl: saved.url,
          fileHash,
          status: ProjectDocumentStatus.PENDIENTE_QA,
          version: 0, // rev0
          projectId: dto.projectId,
          serviceId: dto.serviceId,
          ownerId: userId,
        },
        include: {
          project: true,
          service: true,
          owner: true,
        },
      });

      // Registrar tuplas en OpenFGA
      await this.fga.writeTuples([
        { user: `user:${userId}`, relation: 'owner', object: `document:${doc.id}` },
        { user: `service:${dto.serviceId}`, relation: 'service', object: `document:${doc.id}` },
      ]);

      return doc;
    });
  }

  /**
   * Sube una nueva versión del documento (corrección o actualización).
   */
  async uploadRevision(
    id: string,
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    const doc = await this.prisma.projectDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException('El documento no existe.');
    }

    // Validar permiso en FGA para subir revisiones
    const canUpload = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_upload_revision',
      object: `document:${id}`,
    });
    if (!canUpload) {
      throw new BadRequestException('No tienes permiso para subir revisiones de este documento.');
    }

    // Determinar la nueva versión
    // Si era revA (version 1) y subimos revisión, es revB en draft (version 2)
    const nextVersion = doc.status === ProjectDocumentStatus.APROBADO ? doc.version + 1 : doc.version;
    const revisionString = `rev${nextVersion === 0 ? '0' : String.fromCharCode(64 + nextVersion)}`;

    // Estampar el archivo PDF de la revisión con metadatos oficiales
    let finalBuffer = file.buffer;
    if (file.mimetype === 'application/pdf') {
      const project = await this.prisma.project.findUnique({
        where: { id: doc.projectId },
        include: { client: true },
      });
      const dateStr = new Date().toLocaleDateString('es-CL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      finalBuffer = await this.stampDocumentPdf(file.buffer, {
        code: doc.code,
        revision: revisionString,
        projectName: project?.name || 'S/N',
        clientName: project?.client?.name || 'S/C',
        date: dateStr,
      });
    }

    // Subir nuevo archivo a storage
    const folder = `projects/${doc.projectId}/documents`;
    const saved = await this.storage.save({
      buffer: finalBuffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder,
    });

    const fileHash = createHash('sha256').update(finalBuffer).digest('hex');

    return this.prisma.projectDocument.update({
      where: { id },
      data: {
        previousFileUrl: doc.fileUrl,
        fileUrl: saved.url,
        fileHash,
        status: ProjectDocumentStatus.PENDIENTE_QA,
        version: nextVersion,
        qaSignerId: null,
        qaSignedAt: null,
        clientSignerId: null,
        clientSignedAt: null,
        rejectionReason: null,
      },
      include: {
        project: true,
        service: true,
        owner: true,
      },
    });
  }

  /**
   * Firma y aprueba por QA.
   * Transiciona a PENDIENTE_CLIENTE (si el servicio requiere firma del cliente)
   * o directamente a APROBADO.
   */
  async signQA(id: string, userId: string) {
    const doc = await this.prisma.projectDocument.findUnique({
      where: { id },
      include: { service: true },
    });
    if (!doc) {
      throw new NotFoundException('El documento no existe.');
    }

    // Verificar permiso FGA
    const canSign = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_sign_qa',
      object: `document:${id}`,
    });
    if (!canSign) {
      throw new BadRequestException('No tienes permiso de QA para firmar este documento.');
    }

    // Validar config del servicio
    const config = doc.service.docCodingConfig as Record<string, unknown>;
    const requiresClient = config?.requiresClientSignature === true;

    // Si es rev0 (version 0), al ser aprobado por QA transiciona a revA (version 1)
    const newVersion = doc.version === 0 ? 1 : doc.version;
    const newStatus = requiresClient
      ? ProjectDocumentStatus.PENDIENTE_CLIENTE
      : ProjectDocumentStatus.APROBADO;

    return this.prisma.projectDocument.update({
      where: { id },
      data: {
        status: newStatus,
        version: newVersion,
        qaSignerId: userId,
        qaSignedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        project: true,
        service: true,
        owner: true,
        qaSigner: true,
      },
    });
  }

  /**
   * Firma y aprueba por el Cliente/ITO.
   */
  async signClient(id: string, userId: string) {
    const doc = await this.prisma.projectDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException('El documento no existe.');
    }

    if (doc.status !== ProjectDocumentStatus.PENDIENTE_CLIENTE) {
      throw new BadRequestException('El documento no está pendiente de firma del cliente.');
    }

    // Verificar permiso FGA
    const canSign = await this.fga.check({
      user: `user:${userId}`,
      relation: 'can_sign_client',
      object: `document:${id}`,
    });
    if (!canSign) {
      throw new BadRequestException('No tienes permisos de cliente para firmar este documento.');
    }

    return this.prisma.projectDocument.update({
      where: { id },
      data: {
        status: ProjectDocumentStatus.APROBADO,
        clientSignerId: userId,
        clientSignedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        project: true,
        service: true,
        owner: true,
        qaSigner: true,
        clientSigner: true,
      },
    });
  }

  /**
   * Rechaza el documento indicando el motivo.
   */
  async reject(id: string, userId: string, reason: string) {
    const doc = await this.prisma.projectDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException('El documento no existe.');
    }

    // Verificar si es QA o Cliente según el estado del documento
    let hasAccess = false;
    if (doc.status === ProjectDocumentStatus.PENDIENTE_QA) {
      hasAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_sign_qa',
        object: `document:${id}`,
      });
    } else if (doc.status === ProjectDocumentStatus.PENDIENTE_CLIENTE) {
      hasAccess = await this.fga.check({
        user: `user:${userId}`,
        relation: 'can_sign_client',
        object: `document:${id}`,
      });
    }

    if (!hasAccess) {
      throw new BadRequestException('No tienes permiso para rechazar este documento.');
    }

    return this.prisma.projectDocument.update({
      where: { id },
      data: {
        status: ProjectDocumentStatus.RECHAZADO,
        rejectionReason: reason,
      },
      include: {
        project: true,
        service: true,
        owner: true,
      },
    });
  }

  /**
   * Lista documentos visibles.
   */
  async list(userId: string, projectId?: string, serviceId?: string) {
    // Obtener proyectos accesibles
    const globalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    let allowedProjectIds: string[] | undefined;

    if (!globalAdmin) {
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

      const projects = await this.prisma.project.findMany({
        where: {
          OR: [
            { id: { in: projectIds } },
            { departmentId: { in: departmentIds } },
          ],
        },
        select: { id: true },
      });

      allowedProjectIds = projects.map((p) => p.id);
    }

    const where: Prisma.ProjectDocumentWhereInput = {};
    if (allowedProjectIds) {
      where.projectId = { in: allowedProjectIds };
    }

    if (projectId) {
      if (allowedProjectIds && !allowedProjectIds.includes(projectId)) {
        throw new BadRequestException('No tienes acceso a este proyecto.');
      }
      where.projectId = projectId;
    }

    if (serviceId) {
      where.serviceId = serviceId;
    }

    return this.prisma.projectDocument.findMany({
      where,
      include: {
        project: true,
        service: true,
        owner: true,
        qaSigner: true,
        clientSigner: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Elimina un documento (sólo por su creador/owner o admins).
   */
  async remove(id: string, userId: string) {
    const doc = await this.prisma.projectDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException('El documento no existe.');
    }

    const isOwner = doc.ownerId === userId;
    const isGlobalAdmin = await this.prisma.membership.findFirst({
      where: {
        userId,
        roleKey: 'org_admin',
        scopeType: ScopeType.ORGANIZATION,
      },
    });

    if (!isOwner && !isGlobalAdmin) {
      throw new BadRequestException('No tienes permisos para eliminar este documento.');
    }

    // Eliminar archivo del storage
    const key = doc.fileUrl.split('/files/')[1];
    if (key) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.error(`Error deleting storage file for document ${id}:`, err);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Eliminar tuplas en FGA
      await this.fga.deleteTuples([
        { user: `user:${doc.ownerId}`, relation: 'owner', object: `document:${id}` },
        { user: `service:${doc.serviceId}`, relation: 'service', object: `document:${id}` },
      ]);

      // Eliminar registro
      return tx.projectDocument.delete({ where: { id } });
    });
  }

  /**
   * Estampa un PDF con membrete superior, nomenclatura correlativa y marca de agua.
   */
  private async stampDocumentPdf(
    pdfBuffer: Buffer,
    metadata: {
      code: string;
      revision: string;
      projectName: string;
      clientName: string;
      date: string;
    },
  ): Promise<Buffer> {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pages = pdfDoc.getPages();
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const cleanProjectName = metadata.projectName.toUpperCase();
      const cleanClientName = metadata.clientName.toUpperCase();
      const headerRightText = `PROYECTO: ${cleanProjectName} | CLIENTE: ${cleanClientName}`;
      const footerLeftText = `CÓDIGO: ${metadata.code} | REV: ${metadata.revision}`;
      const footerRightText = `FECHA DE ESTAMPADO: ${metadata.date}`;
      const watermarkText = 'GMT LINK - OFICIAL';

      for (const page of pages) {
        const { width, height } = page.getSize();

        // 1. Dibujar línea y texto de encabezado superior (margen de 35px)
        page.drawLine({
          start: { x: 30, y: height - 35 },
          end: { x: width - 30, y: height - 35 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });

        page.drawText('GMT LINK · CONTROL DE CALIDAD', {
          x: 30,
          y: height - 28,
          size: 7,
          font: helveticaBold,
          color: rgb(0.11, 0.23, 0.42), // Azul marino corporativo (#1C3A6B aprox)
        });

        // Limitar tamaño de texto derecho para que no se traslape
        const maxHeaderRightWidth = width - 250;
        let headerRight = headerRightText;
        if (helvetica.widthOfTextAtSize(headerRight, 7) > maxHeaderRightWidth) {
          headerRight = `PROYECTO: ${cleanProjectName.slice(0, 15)}... | CLIENTE: ${cleanClientName.slice(0, 15)}...`;
        }

        page.drawText(headerRight, {
          x: width - 30 - helvetica.widthOfTextAtSize(headerRight, 7),
          y: height - 28,
          size: 7,
          font: helvetica,
          color: rgb(0.4, 0.4, 0.4),
        });

        // 2. Dibujar línea y texto de pie de página inferior (margen de 35px)
        page.drawLine({
          start: { x: 30, y: 35 },
          end: { x: width - 30, y: 35 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });

        page.drawText(footerLeftText, {
          x: 30,
          y: 22,
          size: 7,
          font: helveticaBold,
          color: rgb(0.11, 0.23, 0.42),
        });

        page.drawText(footerRightText, {
          x: width - 30 - helvetica.widthOfTextAtSize(footerRightText, 7),
          y: 22,
          size: 7,
          font: helvetica,
          color: rgb(0.4, 0.4, 0.4),
        });

        // 3. Marca de agua diagonal en el centro de la página
        const watermarkSize = 36;
        const textWidth = helveticaBold.widthOfTextAtSize(watermarkText, watermarkSize);
        // Centrar con respecto a la diagonal
        const rad = (30 * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        
        // Coordenadas aproximadas para centrar el texto rotado en el centro físico de la página
        const centerX = width / 2;
        const centerY = height / 2;
        // Ajuste del offset para centrar el origen del texto rotado
        const textOffsetX = (textWidth / 2) * cos;
        const textOffsetY = (textWidth / 2) * sin;

        page.drawText(watermarkText, {
          x: centerX - textOffsetX,
          y: centerY - textOffsetY,
          size: watermarkSize,
          font: helveticaBold,
          color: rgb(0.9, 0.9, 0.9), // Muy suave gris
          opacity: 0.12, // Translúcido
          rotate: degrees(30),
        });
      }

      const savedBytes = await pdfDoc.save();
      return Buffer.from(savedBytes);
    } catch (error) {
      this.logger.warn(`No se pudo estampar el PDF, se usará el original. Razón: ${error instanceof Error ? error.message : String(error)}`);
      return pdfBuffer;
    }
  }
}
