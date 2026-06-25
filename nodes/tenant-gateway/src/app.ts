export interface HealthPayload {
  status: 'ok';
  service: string;
  tenant: string;
}

/** Lógica pura del healthcheck; el tenant viene del entorno del despliegue. */
export function handleHealth(tenant: string | undefined): HealthPayload {
  return { status: 'ok', service: 'tenant-gateway', tenant: tenant ?? 'unknown' };
}
