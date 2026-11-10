import { Module } from '@nestjs/common';
import { CatalogService } from './application/catalog.service.js';
import { AdminCatalogController, CatalogController } from './presentation/catalog.controllers.js';

/** Regions, curated places, vehicle categories and the indicative fare estimate. */
@Module({
  controllers: [CatalogController, AdminCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
