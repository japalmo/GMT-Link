import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDesktopDocumentDto } from '../../../src/modules/metrics/dto/metrics.dto';

const base = {
  blob_path: 'documents/R1/PROT-001.pdf',
  file_hash: 'abc123',
  doc_type: 'CR',
  codigo: 'GMT-SQM-SD-P1-TOP-CR-GEN-001',
};

async function validated(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateDesktopDocumentDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateDesktopDocumentDto', () => {
  it('acepta el payload mínimo con task_id', async () => {
    const errors = await validated({ ...base, task_id: 'task-1' });
    expect(errors).toHaveLength(0);
  });

  it('acepta element_code y estado BORRADOR', async () => {
    const errors = await validated({ ...base, element_code: 'R1', estado: 'BORRADOR' });
    expect(errors).toHaveLength(0);
  });

  it('acepta estado PENDIENTE_QA explícito', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', estado: 'PENDIENTE_QA' });
    expect(errors).toHaveLength(0);
  });

  it('rechaza un estado fuera de BORRADOR|PENDIENTE_QA', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', estado: 'APROBADO' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza payload sin blob_path', async () => {
    const rest: Record<string, unknown> = { ...base, task_id: 'task-1' };
    delete rest.blob_path;
    const errors = await validated(rest);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza payload sin codigo', async () => {
    const rest: Record<string, unknown> = { ...base, task_id: 'task-1' };
    delete rest.codigo;
    const errors = await validated(rest);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza campos extra (whitelist estricta del módulo)', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', extra: 'no' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('acepta service_code opcional', async () => {
    const errors = await validated({ ...base, element_code: 'R1', service_code: 'TOP' });
    expect(errors).toHaveLength(0);
  });

  it('rechaza un código con "/" (sería inconsultable por la ruta de status)', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', codigo: 'GMT/X/001' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza un código con espacios u otros caracteres fuera de letras, números y guiones', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', codigo: 'GMT X 001' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza un código de más de 160 caracteres', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', codigo: 'A'.repeat(161) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza blob_path de más de 200 caracteres', async () => {
    const errors = await validated({
      ...base,
      task_id: 'task-1',
      blob_path: `metrics/${'a'.repeat(200)}.pdf`,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza file_hash de más de 128 caracteres', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', file_hash: 'f'.repeat(129) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza doc_type de más de 40 caracteres', async () => {
    const errors = await validated({ ...base, task_id: 'task-1', doc_type: 'X'.repeat(41) });
    expect(errors.length).toBeGreaterThan(0);
  });
});
