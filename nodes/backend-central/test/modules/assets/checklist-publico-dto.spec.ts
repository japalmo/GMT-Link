import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SubmitPublicChecklistDto } from '../../../src/modules/assets/dto/assets.dto';

/**
 * El DTO del envío sin sesión, validado igual que en la API.
 *
 * El `ValidationPipe` corre con `whitelist` y `forbidNonWhitelisted`, así que
 * una propiedad que solo tiene `@Transform` (sin ninguna regla) NO entra en la
 * lista blanca y tumba el envío entero con "property should not exist". Pasó en
 * producción con el formulario de incidentes; esta prueba replica el pipe para
 * que no vuelva a pasar en este.
 */

/** Mismas opciones que el `ValidationPipe` del módulo. */
function validar(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(SubmitPublicChecklistDto, payload, {
    enableImplicitConversion: false,
  });
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: false,
  }).flatMap((e) => Object.values(e.constraints ?? {}));
}

const valido = {
  templateId: 'tpl-1',
  answers: [{ itemId: 'kilometraje', label: 'Kilometraje', value: 103699 }],
  declaredName: 'Yerko Jara',
  declaredEmail: 'yerko@ejemplo.cl',
};

describe('SubmitPublicChecklistDto', () => {
  it('acepta el envío mínimo', () => {
    expect(validar(valido)).toEqual([]);
  });

  it('acepta los campos opcionales de licencia', () => {
    expect(
      validar({
        ...valido,
        declaredLicenseClass: 'B',
        declaredLicenseExpiry: '2028-08-14',
        declaredInternalExpiry: '2027-03-15',
      }),
    ).toEqual([]);
  });

  it('recorta los espacios del nombre y del correo', () => {
    const dto = plainToInstance(SubmitPublicChecklistDto, {
      ...valido,
      declaredName: '  Yerko Jara  ',
      declaredEmail: '  yerko@ejemplo.cl  ',
    });
    expect(dto.declaredName).toBe('Yerko Jara');
    expect(dto.declaredEmail).toBe('yerko@ejemplo.cl');
  });

  it('exige nombre y correo: sin ellos no hay a quién atribuir ni a quién enviar', () => {
    const errores = validar({ templateId: 't', answers: [{}] });
    expect(errores.join(' ')).toContain('nombre');
    expect(errores.join(' ')).toContain('correo');
  });

  it('rechaza un correo inválido', () => {
    expect(validar({ ...valido, declaredEmail: 'no-es-correo' }).join(' ')).toContain('correo');
  });

  it('rechaza una fecha que no es fecha', () => {
    expect(validar({ ...valido, declaredLicenseExpiry: 'ayer' }).length).toBeGreaterThan(0);
  });

  it('rechaza una propiedad que no está declarada', () => {
    // Es lo que protege contra mandar `userId` desde el navegador y que se
    // cuele hasta la base.
    expect(validar({ ...valido, userId: 'admin' }).join(' ')).toContain('should not exist');
  });

  it('NO acepta firma verificada: sin identidad no hay nada que verificar', () => {
    expect(validar({ ...valido, signature: { method: 'WEBAUTHN' } }).join(' ')).toContain(
      'should not exist',
    );
  });
});
