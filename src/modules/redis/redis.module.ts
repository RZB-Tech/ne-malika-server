import { Global, Module } from '@nestjs/common';
import { redisClientProvider } from './redis-client.provider';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [redisClientProvider, RedisService],
  exports: [RedisService],
})
export class RedisModule {}
