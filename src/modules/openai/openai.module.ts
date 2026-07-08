import { Global, Module } from '@nestjs/common';
import { openaiClientProvider } from './openai-client.provider';

@Global()
@Module({
  providers: [openaiClientProvider],
  exports: [openaiClientProvider],
})
export class OpenAiModule {}
