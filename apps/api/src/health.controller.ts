import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@gmt-link/shared-types';

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'gmt-link-api',
      timestamp: new Date().toISOString(),
    };
  }
}
