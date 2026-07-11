import type { ReactNode } from 'react';
import { ROLE_KEYS, type RoleKey } from '@gmt-platform/contracts';
import { ImportWizard, type ImportTemplateColumn } from '@/components/primitives/import-wizard';
import type { CreateUserDto, ImportUsersResponse } from '@/lib/api';
import { roleLabel } from '@/lib/role-labels';

/** Columnas de la plantilla CSV (orden = orden del archivo). */
const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'firstName', label: 'Primer nombre', example: 'Ana' },
  { key: 'secondName', label: 'Segundo nombre', example: 'María' },
  { key: 'lastName', label: 'Apellido paterno', example: 'Pérez' },
  { key: 'secondLastName', label: 'Apellido materno', example: 'Soto' },
  { key: 'username', label: 'Usuario (opcional; se autogenera del email institucional)', example: 'ana.perez' },
  { key: 'emailInstitucional', label: 'Email institucional', example: 'ana.perez@gmt.cl' },
  { key: 'emailPersonal', label: 'Email personal', example: 'ana@gmail.com' },
  { key: 'roleKeys', label: 'Roles (separados por ;)', example: 'operator;viewer' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const VALID_ROLES = new Set<string>(ROLE_KEYS);

/** Deriva un username sugerido del prefijo del email institucional. */
function suggestUsername(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
}

/** Parser CSV mínimo con soporte de campos entre comillas (",", comillas escapadas y saltos). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Última celda/fila si el archivo no termina en salto de línea.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Convierte la celda de roles ("operator;viewer") a RoleKey[]; reporta tokens inválidos. */
function parseRoles(cell: string): { roles: RoleKey[]; invalid: string[] } {
  const roles: RoleKey[] = [];
  const invalid: string[] = [];
  for (const token of cell.split(';').map((t) => t.trim()).filter((t) => t.length > 0)) {
    if (VALID_ROLES.has(token)) {
      const role = token as RoleKey;
      if (!roles.includes(role)) roles.push(role);
    } else {
      invalid.push(token);
    }
  }
  return { roles, invalid };
}

/**
 * Diálogo de importación de usuarios (§1.1). Ensambla la primitiva `ImportWizard`
 * (§5): descarga de plantilla → subir CSV → preview → confirmar. El parseo y la
 * validación por fila ocurren en el cliente (filas malas → errores del wizard);
 * el backend además valida y reporta errores por fila (email duplicado, etc.).
 */
export function ImportUsersDialog({
  open,
  onOpenChange,
  onImport,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: CreateUserDto[]) => Promise<ImportUsersResponse>;
  onImported: (result: ImportUsersResponse) => void;
}): ReactNode {
  async function parseFile(
    file: File,
  ): Promise<{ rows: CreateUserDto[]; errors: { row: number; message: string }[] }> {
    const text = await file.text();
    const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
    if (matrix.length === 0) {
      return { rows: [], errors: [{ row: 0, message: 'El archivo está vacío.' }] };
    }

    const header = (matrix[0] ?? []).map((h) => h.trim());
    const idx = (key: string): number => header.indexOf(key);
    const required = ['firstName', 'lastName', 'roleKeys'];
    const missing = required.filter((k) => idx(k) === -1);
    if (missing.length > 0) {
      return {
        rows: [],
        errors: [{ row: 0, message: `Faltan columnas en la cabecera: ${missing.join(', ')}.` }],
      };
    }

    const rows: CreateUserDto[] = [];
    const errors: { row: number; message: string }[] = [];
    const cell = (r: string[], key: string): string => (r[idx(key)] ?? '').trim();

    for (let i = 1; i < matrix.length; i += 1) {
      const raw = matrix[i] ?? [];
      const rowNo = i + 1; // 1-indexado, contando la cabecera
      const firstName = cell(raw, 'firstName');
      const lastName = cell(raw, 'lastName');
      const emailInstitucional = cell(raw, 'emailInstitucional');
      const emailPersonal = cell(raw, 'emailPersonal');
      const username = cell(raw, 'username') || suggestUsername(emailInstitucional);
      const { roles, invalid } = parseRoles(cell(raw, 'roleKeys'));

      const problems: string[] = [];
      if (firstName.length === 0) problems.push('falta el primer nombre');
      if (lastName.length === 0) problems.push('falta el apellido paterno');
      if (!USERNAME_RE.test(username)) problems.push('usuario inválido (3-30, minúsculas . _ -)');
      if (!emailInstitucional && !emailPersonal) problems.push('falta al menos un email');
      if (emailInstitucional && !EMAIL_RE.test(emailInstitucional)) problems.push('email institucional inválido');
      if (emailPersonal && !EMAIL_RE.test(emailPersonal)) problems.push('email personal inválido');
      if (invalid.length > 0) problems.push(`roles desconocidos: ${invalid.join(', ')}`);
      if (roles.length === 0) problems.push('sin roles válidos');

      if (problems.length > 0) {
        errors.push({ row: rowNo, message: problems.join('; ') });
        continue;
      }

      const secondName = cell(raw, 'secondName');
      const secondLastName = cell(raw, 'secondLastName');
      rows.push({
        firstName,
        lastName,
        username,
        emailInstitucional: emailInstitucional || undefined,
        emailPersonal: emailPersonal || undefined,
        roleKeys: roles,
        secondName: secondName.length > 0 ? secondName : undefined,
        secondLastName: secondLastName.length > 0 ? secondLastName : undefined,
      });
    }

    return { rows, errors };
  }

  async function handleConfirm(rows: CreateUserDto[]): Promise<void> {
    const result = await onImport(rows);
    onImported(result);
  }

  return (
    <ImportWizard<CreateUserDto>
      open={open}
      onOpenChange={onOpenChange}
      title="Importar usuarios"
      description="Carga un CSV con la plantilla para crear varios usuarios."
      templateFileName="plantilla-usuarios"
      templateColumns={TEMPLATE_COLUMNS}
      parseFile={parseFile}
      previewColumns={[
        {
          header: 'Nombre',
          render: (r) => `${r.firstName} ${r.lastName}`,
        },
        { header: 'Usuario', render: (r) => r.username },
        { header: 'Email', render: (r) => r.emailInstitucional ?? r.emailPersonal ?? '—' },
        {
          header: 'Roles',
          render: (r) => r.roleKeys.map((role) => roleLabel(role)).join(', '),
        },
      ]}
      onConfirm={handleConfirm}
    />
  );
}
