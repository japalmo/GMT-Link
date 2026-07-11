import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Regla de negocio §4.1: un usuario debe tener AL MENOS uno de {emailInstitucional, emailPersonal}.
 * Se aplica sobre una propiedad SIEMPRE presente (username) para que no la corte un `@IsOptional`
 * de los propios campos email. Sirve al form individual y al lote CSV (ambos validan el mismo DTO).
 */
export function AtLeastOneEmail(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneEmail',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const o = args.object as { emailInstitucional?: string; emailPersonal?: string };
          return Boolean(o.emailInstitucional?.trim() || o.emailPersonal?.trim());
        },
        defaultMessage(): string {
          return 'Debe indicar al menos un email (institucional o personal).';
        },
      },
    });
  };
}
