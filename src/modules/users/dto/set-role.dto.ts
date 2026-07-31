import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class SetRoleDto {
  @ApiProperty({ enum: ['seller', 'admin'], example: 'admin' })
  @IsIn(['seller', 'admin'])
  role: 'seller' | 'admin';
}
