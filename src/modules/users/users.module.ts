import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { AdminUsersController } from './admin-users.controller';

@Module({
  controllers: [AdminUsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
