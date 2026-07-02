import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body de `POST /roles/:key/clone`. */
export class CloneRoleDto {
  @IsString()
  @MinLength(1, { message: 'El nombre del rol clonado es obligatorio.' })
  @MaxLength(80)
  label!: string;
}
