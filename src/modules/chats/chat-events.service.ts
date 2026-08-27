import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, timer } from 'rxjs';

export interface ChatEvent {
  chatId: number;
  kind: 'message' | 'read';
}

interface Envelope extends ChatEvent {
  userId: number;
}

const HEARTBEAT_MS = 25_000;

@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private readonly events = new Subject<Envelope>();

  emit(userId: number, event: ChatEvent): void {
    this.events.next({ userId, ...event });
  }

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
