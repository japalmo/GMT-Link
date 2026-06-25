import { describe, it, expect } from 'vitest';
import { handleHealth } from './app.js';

describe('tenant-gateway handleHealth', () => {
  it('reporta ok con el nombre del servicio y el tenant del entorno', () => {
    expect(handleHealth('albemarle')).toEqual({
      status: 'ok',
      service: 'tenant-gateway',
      tenant: 'albemarle',
    });
  });

  it('usa "unknown" cuando no hay tenant configurado', () => {
    expect(handleHealth(undefined)).toEqual({
      status: 'ok',
      service: 'tenant-gateway',
      tenant: 'unknown',
    });
  });
});
