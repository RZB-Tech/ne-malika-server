import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AnyRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ChatsService } from './chats.service';
import {
  ChatMessageDto,
  ChatStartedDto,
  ChatUnreadDto,
  FindChatsQueryDto,
  PaginatedChatMessagesDto,
  PaginatedChatsDto,
  SendMessageDto,
  StartChatDto,
} from './dto/chat.dto';

@ApiTags('chats')
@ApiBearerAuth('access-token')
@AnyRole()
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Мои переписки',
    description:
      'role=buyer — те, что я начал сам; role=seller — переписки моего магазина.',
  })
  @ApiOkResponse({ type: PaginatedChatsDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FindChatsQueryDto,
  ) {
    return this.chatsService.list(user, query);
  }

  /** Объявлено до маршрутов с параметром — иначе «unread» ушло бы в ParseIntPipe. */
  @Get('unread')
  @ApiOperation({ summary: 'Сколько непрочитанного в обеих ролях' })
  @ApiOkResponse({ type: ChatUnreadDto })
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.unread(user);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Сообщения переписки',
    description:
      'Свежие первыми. Запрос заодно отмечает входящие прочитанными: ленту ' +
      'запрашивают, только когда переписка открыта на экране.',
  })
  @ApiOkResponse({ type: PaginatedChatMessagesDto })
  @ApiResponse({ status: 404, description: 'Переписка не найдена или чужая' })
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PaginationQueryDto,
  ) {
    return this.chatsService.messages(user, id, query);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Написать продавцу',
    description:
      'Находит начатый разговор о том же товаре или заводит новый и сразу ' +
      'отправляет первое сообщение.',
  })
  @ApiResponse({ status: 201, type: ChatStartedDto })
  @ApiResponse({ status: 400, description: 'Свой же магазин' })
  @ApiResponse({ status: 404, description: 'Товар не найден или недоступен' })
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartChatDto) {
    return this.chatsService.start(user, dto);
  }

  @Post(':id/messages')
  // Лимит выше, чем у создания переписки: живой разговор — это несколько
  // коротких реплик подряд, и упереться в него человек не должен.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Отправить сообщение' })
  @ApiOkResponse({ type: ChatMessageDto })
  @ApiResponse({ status: 404, description: 'Переписка не найдена или чужая' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatsService.send(user, id, dto);
  }
}
