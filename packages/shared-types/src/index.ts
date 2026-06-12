/**
 * @gtm-link/shared-types — tipos compartidos del monorepo.
 * Los tipos de dominio se agregan por etapa según el plan maestro (§4.2).
 */

/** Respuesta del endpoint GET /health de apps/api. Valida el wiring del workspace en 0.1. */
export interface HealthResponse {
  status: 'ok';
  service: 'gtm-link-api';
  timestamp: string;
}

/** Scopes de membresía (§4.2 — enum ScopeType). */
export type ScopeType = 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'SERVICE';
