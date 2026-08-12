import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, timer } from 'rxjs';

/**
 * Что случилось в переписке. Само сообщение не шлём: клиент по событию
 * перезапрашивает ленту и получает её ровно в том виде, в каком её отдаёт
 * обычный запрос — с проверкой доступа и отметками о прочтении. Событие здесь
 * только повод сходить за данными, а не источник правды.
 */
export interface ChatEvent {
  chatId: number;
  /** `message` — пришло новое, `read` — собеседник прочитал. */
  kind: 'message' | 'read';
}

interface Envelope extends ChatEvent {
  userId: number;
}

/**
 * Пульс: без него прокси считает молчащее соединение мёртвым и рвёт его через
 * минуту-полторы. Двадцать пять секунд — с запасом под самый нетерпеливый.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Живой канал к открытым вкладкам.
 *
 * Один процесс — одна шина. Когда инстансов станет несколько, сюда добавится
 * publish/subscribe Redis: события будут уходить в канал, а `stream` слушать
 * его же. Менять придётся только этот файл — снаружи видно два метода.
 */
@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private readonly events = new Subject<Envelope>();

  /** Кому-то из участников переписки — сообщить, что она изменилась. */
  emit(userId: number, event: ChatEvent): void {
    this.events.next({ userId, ...event });
  }

  /**
   * Поток событий одного человека в формате SSE. Держится открытым, пока
   * открыта вкладка; отписка происходит сама, когда браузер закрывает
   * соединение.
   */
  stream(userId: number): Observable<{ data: ChatEvent | { kind: 'ping' } }> {
    const own = this.events.pipe(
      filter((envelope) => envelope.userId === userId),
      map(({ chatId, kind }) => ({ data: { chatId, kind } })),
    );

    const heartbeat = timer(HEARTBEAT_MS, HEARTBEAT_MS).pipe(
      map(() => ({ data: { kind: 'ping' as const } })),
    );

    this.logger.debug(`Открыт поток событий для пользователя ${userId}`);
    return merge(own, heartbeat);
  }
}
