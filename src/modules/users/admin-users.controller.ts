import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../../common/types/auth.types';
import { ReasonDto } from '../../common/dto/reason.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { UsersService } from './users.service';

@ApiTags('users-admin')
@ApiBearerAuth('access-token')
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Все пользователи с их магазином и числом товаров' })
  list(@Query() query: PaginationQueryDto) {
    return this.usersService.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Карточка пользователя и его последние изменённые товары',
  })
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getForAdmin(id);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Выдать или снять права администратора' })
  setRole(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRoleDto,
  ) {
    this.assertNotSelf(admin, id, 'Нельзя менять роль самому себе');
    return this.usersService.setRole(id, dto.role);
  }

  @Patch(':id/block')
  @ApiOperation({
    summary:
      'Заблокировать продавца. В отличие от упразднения магазина закрывает вход в кабинет',
  })
  block(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReasonDto,
  ) {
    this.assertNotSelf(admin, id, 'Нельзя заблокировать самого себя');
    return this.usersService.setBlocked(id, dto.reason);
  }

  @Patch(':id/unblock')
  @ApiOperation({ summary: 'Снять блокировку с продавца' })
  unblock(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.setBlocked(id, null);
  }

  private assertNotSelf(
    admin: AuthenticatedUser,
    targetId: number,
    message: string,
  ) {
    if (admin.id === targetId) {
      throw new ForbiddenException(message);
    }
  }
}
