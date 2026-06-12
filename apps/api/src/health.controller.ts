import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@gtm-link/shared-types';

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'gtm-link-api',
      timestamp: new Date().toISOString(),
    };
  }
}
