import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthResponse } from '@gmt-platform/contracts';

@SkipThrottle()
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
