import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { type UserRole } from '../../../common/types/auth.types';

export class SetRoleDto {
  @ApiProperty({ enum: ['user', 'seller', 'admin'], example: 'admin' })
  @IsIn(['user', 'seller', 'admin'])
  role: UserRole;
}
