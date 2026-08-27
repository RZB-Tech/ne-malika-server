import { Module } from '@nestjs/common';
import { FavoritesRepository } from './favorites.repository';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';

@Module({
  controllers: [FavoritesController],
  providers: [FavoritesRepository, FavoritesService],
})
export class FavoritesModule {}
