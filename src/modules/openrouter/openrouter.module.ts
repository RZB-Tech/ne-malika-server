import { Module } from '@nestjs/common';
import {
  openrouterClientProvider,
  OPENROUTER_CLIENT,
} from './openrouter-client.provider';

@Module({
  providers: [openrouterClientProvider],
  exports: [OPENROUTER_CLIENT],
})
export class OpenrouterModule {}
