import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, Matches } from 'class-validator';

const WEEK_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/; // "09:00", "18:30"

export class WorkScheduleEntryDto {
  @ApiProperty({ enum: WEEK_DAYS, example: 'Mo' })
  @IsIn(WEEK_DAYS)
  day: (typeof WEEK_DAYS)[number];

  @ApiProperty({ example: '09:00', description: 'Формат HH:mm' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'start должен быть в формате HH:mm' })
  start: string;

  @ApiProperty({ example: '18:00', description: 'Формат HH:mm' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'end должен быть в формате HH:mm' })
  end: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  isHoliday: boolean;
}
