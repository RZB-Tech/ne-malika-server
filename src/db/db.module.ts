import { Global, Module } from '@nestjs/common';
import { drizzleProvider } from './db.provider';

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [drizzleProvider],
})
export class DbModule {}
