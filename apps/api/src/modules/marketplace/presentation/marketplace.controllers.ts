import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccountRole,
  ApiRoutes,
  Permission,
  type AdminDocument,
  type DriverDocument,
  type DriverListing,
  type DriverProfile,
  type DriverPublicProfile,
  type Paginated,
  type Vehicle,
  type VehicleAuthorization,
  type VerificationCase,
  type VerificationQueueItem,
} from '@payana/contracts';
import { CurrentUser, Public, RequirePermission, Roles, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { AuthorizationsService } from '../application/authorizations.service.js';
import { DiscoveryService } from '../application/discovery.service.js';
import { PartnerService } from '../application/partner.service.js';
import { VerificationService } from '../application/verification.service.js';
import {
  CreateAuthorizationDto,
  DecideVerificationDto,
  DriverProfileQueryDto,
  DriverSearchQueryDto,
  LocationPingDto,
  ModerateListingDto,
  ReviewDocumentDto,
  SubmitDocumentDto,
  UpdateAvailabilityDto,
  UpdateRatesDto,
  UpsertDriverProfileDto,
  UpsertVehicleDto,
  VerificationQueueQueryDto,
} from './marketplace.dto.js';

@ApiTags('discovery')
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get(ApiRoutes.drivers.search)
  @ApiContract({ summary: 'Find drivers near a point or within a region', response: 'DriverListing', paginated: true })
  search(@Query() q: DriverSearchQueryDto): Promise<Paginated<DriverListing>> {
    return this.discovery.search(q);
  }

  @Public()
  @Get(r(ApiRoutes.drivers.profile(':driverId')))
  @ApiContract({ summary: 'Public profile of a listed driver', response: 'DriverPublicProfile' })
  profile(
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Query() q: DriverProfileQueryDto,
  ): Promise<DriverPublicProfile> {
    const from = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    return this.discovery.profile(driverId, from);
  }
}

/** Partner self-service. Every route needs the driver role; ownership is checked in the services. */
@ApiTags('driver')
@ApiBearerAuth()
@Roles(AccountRole.Driver)
@Controller()
export class PartnerController {
  constructor(
    private readonly partners: PartnerService,
    private readonly authorizations: AuthorizationsService,
  ) {}

  @Get(ApiRoutes.driver.profile)
  @ApiContract({ summary: 'The caller’s partner profile', response: 'DriverProfile', nullable: true })
  getProfile(@CurrentUser() user: AuthUser): Promise<DriverProfile | null> {
    return this.partners.getOwnProfile(user);
  }

  @Put(ApiRoutes.driver.profile)
  @ApiContract({ summary: 'Create or update the partner profile', body: 'UpsertDriverProfileRequest', response: 'DriverProfile' })
  putProfile(@CurrentUser() user: AuthUser, @Body() body: UpsertDriverProfileDto): Promise<DriverProfile> {
    return this.partners.upsertProfile(user, body);
  }

  @Post(ApiRoutes.driver.submitForReview)
  @HttpCode(200)
  @ApiContract({ summary: 'Submit the profile for verification', response: 'DriverProfile' })
  submit(@CurrentUser() user: AuthUser): Promise<DriverProfile> {
    return this.partners.submitForReview(user);
  }

  @Get(ApiRoutes.driver.vehicles)
  @ApiContract({ summary: 'Vehicles registered to the caller', response: 'Vehicle', array: true })
  listVehicles(@CurrentUser() user: AuthUser): Promise<Vehicle[]> {
    return this.partners.listVehicles(user);
  }

  @Post(ApiRoutes.driver.vehicles)
  @ApiContract({ summary: 'Add a vehicle', body: 'UpsertVehicleRequest', response: 'Vehicle', status: 201 })
  createVehicle(@CurrentUser() user: AuthUser, @Body() body: UpsertVehicleDto): Promise<Vehicle> {
    return this.partners.createVehicle(user, body);
  }

  @Put(r(ApiRoutes.driver.vehicle(':vehicleId')))
  @ApiContract({ summary: 'Update a vehicle', body: 'UpsertVehicleRequest', response: 'Vehicle' })
  updateVehicle(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() body: UpsertVehicleDto,
  ): Promise<Vehicle> {
    return this.partners.updateVehicle(user, vehicleId, body);
  }

  @Delete(r(ApiRoutes.driver.vehicle(':vehicleId')))
  @HttpCode(204)
  @ApiContract({ summary: 'Remove a vehicle' })
  deleteVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string): Promise<void> {
    return this.partners.deleteVehicle(user, vehicleId);
  }

  @Put(ApiRoutes.driver.rates)
  @ApiContract({ summary: 'Set indicative rates for a vehicle', body: 'UpdateRatesRequest', response: 'Vehicle' })
  updateRates(@CurrentUser() user: AuthUser, @Body() body: UpdateRatesDto): Promise<Vehicle> {
    return this.partners.updateRates(user, body);
  }

  @Get(ApiRoutes.driver.documents)
  @ApiContract({ summary: 'Documents the caller has submitted', response: 'DriverDocument', array: true })
  listDocuments(@CurrentUser() user: AuthUser): Promise<DriverDocument[]> {
    return this.partners.listDocuments(user);
  }

  @Post(ApiRoutes.driver.documents)
  @ApiContract({ summary: 'Submit a document for verification', body: 'SubmitDocumentRequest', response: 'DriverDocument', status: 201 })
  submitDocument(@CurrentUser() user: AuthUser, @Body() body: SubmitDocumentDto): Promise<DriverDocument> {
    return this.partners.submitDocument(user, body);
  }

  @Put(ApiRoutes.driver.availability)
  @ApiContract({ summary: 'Go online, busy or offline', body: 'UpdateAvailabilityRequest', response: 'DriverProfile' })
  availability(@CurrentUser() user: AuthUser, @Body() body: UpdateAvailabilityDto): Promise<DriverProfile> {
    return this.partners.updateAvailability(user, body);
  }

  @Post(ApiRoutes.driver.location)
  @HttpCode(204)
  @ApiContract({ summary: 'Report the driver’s current position', body: 'LocationPing' })
  location(@CurrentUser() user: AuthUser, @Body() body: LocationPingDto): Promise<void> {
    return this.partners.recordLocation(user, body);
  }

  @Get(ApiRoutes.driver.authorizations)
  @ApiContract({ summary: 'Owner-driver authorisations granted or received', response: 'VehicleAuthorization', array: true })
  listAuthorizations(@CurrentUser() user: AuthUser): Promise<VehicleAuthorization[]> {
    return this.authorizations.list(user);
  }

  @Post(ApiRoutes.driver.authorizations)
  @ApiContract({ summary: 'Authorise a driver to operate one of your vehicles', body: 'CreateAuthorizationRequest', response: 'VehicleAuthorization', status: 201 })
  createAuthorization(@CurrentUser() user: AuthUser, @Body() body: CreateAuthorizationDto): Promise<VehicleAuthorization> {
    return this.authorizations.create(user, body);
  }

  @Post(r(ApiRoutes.driver.acceptAuthorization(':authId')))
  @HttpCode(200)
  @ApiContract({ summary: 'Accept an authorisation invitation', response: 'VehicleAuthorization' })
  acceptAuthorization(@CurrentUser() user: AuthUser, @Param('authId', ParseUUIDPipe) authId: string): Promise<VehicleAuthorization> {
    return this.authorizations.accept(user, authId);
  }

  @Post(r(ApiRoutes.driver.revokeAuthorization(':authId')))
  @HttpCode(200)
  @ApiContract({ summary: 'End an authorisation', response: 'VehicleAuthorization' })
  revokeAuthorization(@CurrentUser() user: AuthUser, @Param('authId', ParseUUIDPipe) authId: string): Promise<VehicleAuthorization> {
    return this.authorizations.revoke(user, authId);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get(ApiRoutes.admin.verifications)
  @RequirePermission(Permission.VerificationRead)
  @ApiContract({ summary: 'Verification queue', response: 'VerificationQueueItem', paginated: true })
  queue(@Query() q: VerificationQueueQueryDto): Promise<Paginated<VerificationQueueItem>> {
    return this.verification.queue(q);
  }

  @Get(r(ApiRoutes.admin.verification(':driverProfileId')))
  @RequirePermission(Permission.VerificationRead)
  @ApiContract({ summary: 'A partner’s verification case: profile, vehicles, documents, history', response: 'VerificationCase' })
  getCase(@Param('driverProfileId', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<VerificationCase> {
    return this.verification.getCase(id, actor);
  }

  @Post(r(ApiRoutes.admin.decideVerification(':driverProfileId')))
  @HttpCode(200)
  @RequirePermission(Permission.VerificationReview)
  @ApiContract({ summary: 'Approve, reject, suspend or reinstate a partner', body: 'DecideVerificationRequest', response: 'VerificationCase' })
  decide(
    @Param('driverProfileId', ParseUUIDPipe) id: string,
    @Body() body: DecideVerificationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<VerificationCase> {
    return this.verification.decide(id, body, actor);
  }

  @Post(r(ApiRoutes.admin.reviewDocument(':documentId')))
  @HttpCode(200)
  @RequirePermission(Permission.VerificationReview)
  @ApiContract({ summary: 'Approve or reject one document', body: 'ReviewDocumentRequest', response: 'AdminDocument' })
  reviewDocument(
    @Param('documentId', ParseUUIDPipe) id: string,
    @Body() body: ReviewDocumentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminDocument> {
    return this.verification.reviewDocument(id, body, actor);
  }

  @Post(r(ApiRoutes.admin.moderateListing(':vehicleId')))
  @HttpCode(200)
  @RequirePermission(Permission.ListingsModerate)
  @ApiContract({ summary: 'Publish, unlist or suspend a vehicle listing', body: 'ModerateListingRequest', response: 'Vehicle' })
  moderateListing(
    @Param('vehicleId', ParseUUIDPipe) id: string,
    @Body() body: ModerateListingDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Vehicle> {
    return this.verification.moderateListing(id, body, actor);
  }
}
