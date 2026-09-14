import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';

/**
 * Reglas del archivo de un documento personal, compartidas por "Mis documentos"
 * y por la carga que hace RRHH en nombre del trabajador. Una sola definición: si
 * cada puerta validara por su cuenta, un PDF podría entrar por una y ser
 * rechazado por la otra.
 */

/** Tamaño máximo del documento (10 MB), alineado con el storage. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** MIME aceptados: PDF e imágenes comunes (§6-1.5). */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
]);

/** Archivo multipart ya validado, en la forma mínima que usa el servicio. */
export interface ArchivoDocumento {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/** Valida presencia y MIME del archivo subido. */
export function validarArchivoDocumento(file: Express.Multer.File | undefined): ArchivoDocumento {
  if (!file) {
    throw new BadRequestException('Falta el archivo (campo "file").');
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new UnsupportedMediaTypeException(
      'El archivo debe ser PDF o imagen (PNG/JPEG/WebP/HEIC).',
    );
  }
  return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
}
