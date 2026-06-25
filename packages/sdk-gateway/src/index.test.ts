import { describe, it, expect } from 'vitest';
import { GatewayClient } from './index.js';

describe('GatewayClient', () => {
  it('normaliza el baseUrl quitando la barra final', () => {
    const client = new GatewayClient({ baseUrl: 'https://gw.example.com/' });
    expect(client.baseUrl).toBe('https://gw.example.com');
  });

  it('expone el tenant configurado', () => {
    const client = new GatewayClient({ baseUrl: 'https://gw', tenant: 'albemarle' });
    expect(client.tenant).toBe('albemarle');
  });
});
