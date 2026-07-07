import { ApiProperty } from '@nestjs/swagger';

class AuthUserDto {
  @ApiProperty({ example: 42 })
  id: number;

  @ApiProperty({ example: 'Иван Иванов' })
  fullname: string;

  @ApiProperty({ enum: ['seller', 'admin'], example: 'seller' })
  role: 'seller' | 'admin';

  @ApiProperty({ nullable: true, example: 'ivan_ivanov' })
  telegramUsername?: string | null;

  @ApiProperty({ nullable: true })
  telegramPhoto?: string | null;

  @ApiProperty({ nullable: true, example: '+998901234567' })
  phoneNumber?: string | null;

  @ApiProperty({
    description: 'Получен ли номер телефона через бота',
    example: false,
  })
  hasContact: boolean;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access-токен, короткий TTL' })
  accessToken: string;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}
