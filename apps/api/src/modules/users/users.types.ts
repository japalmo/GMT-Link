import type { ProvisionedUser, RoleKey } from '@gtm-link/shared-types';

export type { ProvisionedUser, RoleKey };

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
  status: string;
  isClientUser: boolean;
  roleKeys: RoleKey[];
  createdAt: string;
}

/** Respuesta de asignar / quitar rol (§1.1). */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
}
