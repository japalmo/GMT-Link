import type { HealthResponse } from '@gmt-platform/contracts';

export interface GatewayClientOptions {
  /** URL base del tenant-gateway, p.ej. https://gw-albemarle.internal */
  baseUrl: string;
  /** Identificador del tenant (gmt | albemarle | mantos-blancos). */
  tenant?: string;
  /** Token de servicio backend→gateway (se inyecta en Authorization). */
  serviceToken?: string;
}

/**
 * Cliente tipado que backend-central usará para hablar con un tenant-gateway.
 * Scaffold de Fase 1: solo expone configuración y un health(). La superficie
 * real (CRUD de dominio, decisiones FGA) se agrega en la Fase 2.
 */
export class GatewayClient {
  readonly baseUrl: string;
  readonly tenant: string | undefined;
  private readonly serviceToken: string | undefined;

  constructor(options: GatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tenant = options.tenant;
    this.serviceToken = options.serviceToken;
  }

  /** Llama al /health del gateway. Útil para readiness checks. */
  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.serviceToken ? { Authorization: `Bearer ${this.serviceToken}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Gateway ${this.tenant ?? this.baseUrl} no saludable: HTTP ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  }
}
