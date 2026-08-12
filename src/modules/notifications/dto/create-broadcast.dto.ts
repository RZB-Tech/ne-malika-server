import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const BROADCAST_AUDIENCES = ['all', 'sellers', 'buyers'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

/**
 * Потолок взят у Telegram: sendMessage не принимает текст длиннее 4096
 * символов, и обрезать чужую рассылку молча было бы хуже, чем не принять её.
 */
export const BROADCAST_MAX_LENGTH = 4096;

/**
 * Теги, которые Telegram понимает при parse_mode=HTML. Всё остальное («<br>»,
 * «<div>», да и просто «<» в тексте вроде «Скидки <50%») он считает ошибкой
 * разметки и отвечает 400 — одинаково по каждому адресату.
 */
const ALLOWED_TAGS = [
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'a',
  'code',
  'pre',
  'span',
  'tg-spoiler',
  'blockquote',
];

const TAG_RE = /<\/?([a-zA-Z-]+)(\s[^<>]*)?>/g;

/**
 * Проверка разметки до отправки.
 *
 * Без неё сломанный тег означал ноль доставленных при полном проходе по всей
 * базе: 400 не отписывает адресата и не прерывает цикл, поэтому рассылка
 * молча «уходила» всем и не доходила ни до кого.
 */
@ValidatorConstraint({ name: 'telegramHtml' })
export class TelegramHtmlConstraint implements ValidatorConstraintInterface {
  private problem = 'разметка не по правилам Telegram';

  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    const stack: string[] = [];
    let match: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;

    while ((match = TAG_RE.exec(value)) !== null) {
      const raw = match[0];
      const name = match[1].toLowerCase();

      if (!ALLOWED_TAGS.includes(name)) {
        this.problem = `тег <${name}> Telegram не поддерживает`;
        return false;
      }
      if (raw.startsWith('</')) {
        if (stack.pop() !== name) {
          this.problem = `закрывающий </${name}> не на своём месте`;
          return false;
        }
      } else {
        stack.push(name);
      }
    }

    if (stack.length > 0) {
      this.problem = `тег <${stack[stack.length - 1]}> не закрыт`;
      return false;
    }

    const withoutTags = value.replace(TAG_RE, '');
    if (withoutTags.includes('<') || withoutTags.includes('>')) {
      this.problem =
        'символы «<» и «>» вне тегов нужно записать как &lt; и &gt;';
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return `Текст не отправлен: ${this.problem}.`;
  }
}

export class CreateBroadcastDto {
  @ApiProperty({ enum: BROADCAST_AUDIENCES })
  @IsIn(BROADCAST_AUDIENCES)
  audience: BroadcastAudience;

  @ApiProperty({
    minLength: 5,
    maxLength: BROADCAST_MAX_LENGTH,
    description: 'Текст сообщения. Допускается HTML-разметка Telegram.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(BROADCAST_MAX_LENGTH)
  @Validate(TelegramHtmlConstraint)
  text: string;
}

export class BroadcastAudienceCountDto {
  @ApiProperty({ description: 'Сколько чатов в Telegram получат рассылку' })
  count: number;

  @ApiProperty({ description: 'Сколько браузеров подписано на уведомления' })
  push: number;
}

export class BroadcastDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: BROADCAST_AUDIENCES })
  audience: BroadcastAudience;

  @ApiProperty()
  text: string;

  @ApiProperty()
  recipients: number;

  @ApiProperty()
  delivered: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ description: 'Доставлено в браузеры' })
  pushDelivered: number;

  @ApiProperty()
  pushFailed: number;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional({ nullable: true })
  authorName: string | null;
}

export class BroadcastStartedDto {
  @ApiProperty({ description: 'Идентификатор записи в истории рассылок' })
  id: number;

  @ApiProperty({ description: 'Сколько адресатов найдено на момент запуска' })
  recipients: number;
}
