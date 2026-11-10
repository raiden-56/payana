import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AuthorizationsService } from './application/authorizations.service.js';
import { DiscoveryService } from './application/discovery.service.js';
import { MarketplaceFacade, PartnerOperations } from './application/marketplace.facade.js';
import { MarketplaceJobs } from './application/marketplace.jobs.js';
import { PartnerService } from './application/partner.service.js';
import { VerificationService } from './application/verification.service.js';
import { AdminVerificationController, DiscoveryController, PartnerController } from './presentation/marketplace.controllers.js';

/**
 * Driver and vehicle marketplace: partner onboarding, vehicles, documents,
 * owner-driver authorisations, verification and public discovery.
 * Other modules use it only through MarketplaceFacade.
 */
@Module({
  imports: [CatalogModule],
  controllers: [DiscoveryController, PartnerController, AdminVerificationController],
  providers: [PartnerService, AuthorizationsService, VerificationService, DiscoveryService, MarketplaceFacade, PartnerOperations, MarketplaceJobs],
  exports: [MarketplaceFacade, PartnerOperations],
})
export class MarketplaceModule {}
