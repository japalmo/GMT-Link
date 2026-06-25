import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@gmt-platform/contracts';

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
