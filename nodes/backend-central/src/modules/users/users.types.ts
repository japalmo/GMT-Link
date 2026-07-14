import type { Paginated, ProvisionedUser, RoleKey, UserMembership } from '@gmt-platform/contracts';

export type { Paginated, ProvisionedUser, RoleKey, UserMembership };

/**
 * Respuesta de `POST /users` (§1.1).
 * `provisionalPassword` se retorna SOLO aquí (y en import): nunca se persiste en
 * claro ni se puede releer después (decisión §9: el admin la copia desde la UI).
 */
export interface CreateUserResponse {
  user: ProvisionedUser;
  provisionalPassword: string;
}

/** Fila creada con éxito en una importación de lote. */
export interface ImportCreatedRow {
  id: string;
  email: string;
  username: string;
  provisionalPassword: string;
}

/** Fila que falló durante la importación (no aborta el lote). */
export interface ImportErrorRow {
  index: number;
  email: string;
  message: string;
}

/** Respuesta de `POST /users/import` (§1.1). */
export interface ImportUsersResponse {
  created: ImportCreatedRow[];
  errors: ImportErrorRow[];
}

/** Item de lista / detalle de usuario (datos para `RoleScopedList`, §5). Sin campos sensibles. */
export interface UserListItem {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  status: string;
  isClientUser: boolean;
  cargo: string | null;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
  createdAt: string;
  /** Primer acceso completado (ISO) o null si la invitación aún no se ha usado. */
  firstLoginAt: string | null;
}

/** Respuesta de `POST /users/:id/resend-invite`: la nueva clave provisoria (se muestra una vez). */
export interface ResendInviteResponse {
  provisionalPassword: string;
}

/** Respuesta de asignar / quitar rol — EXTENDIDA (enmienda A4). */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
}
