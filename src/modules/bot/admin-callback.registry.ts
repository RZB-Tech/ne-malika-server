import { Injectable } from '@nestjs/common';

export interface AdminCallbackResult {
  text: string;
  removeButtons?: boolean;
}

export type AdminCallbackHandler = (
  telegramId: number,
  data: string,
) => Promise<AdminCallbackResult | null>;

@Injectable()
export class AdminCallbackRegistry {
  private readonly handlers: AdminCallbackHandler[] = [];

  register(handler: AdminCallbackHandler): void {
    this.handlers.push(handler);
  }

  async handle(
    telegramId: number,
    data: string,
  ): Promise<AdminCallbackResult | null> {
    for (const handler of this.handlers) {
      const result = await handler(telegramId, data);
      if (result) return result;
    }
    return null;
  }
}
