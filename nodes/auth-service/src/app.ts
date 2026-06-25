export interface HealthPayload {
  status: 'ok';
  service: string;
}

/** Lógica pura del healthcheck (testeable sin levantar el servidor). */
export function handleHealth(): HealthPayload {
  return { status: 'ok', service: 'auth-service' };
}
