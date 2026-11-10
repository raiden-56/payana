import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PromotionsService } from './application/promotions.service.js';
import { AdminPromotionsController, AdsController, PackagesController } from './presentation/promotions.controllers.js';

/** Sightseeing packages and local-business advertisements. */
@Module({
  imports: [CatalogModule],
  controllers: [PackagesController, AdsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
