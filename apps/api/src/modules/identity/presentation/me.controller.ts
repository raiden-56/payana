import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiRoutes,
  type ConsentPreferences,
  type DeletionRequestStatus,
  type EmergencyContact,
  type Me,
  type SavedPlace,
} from '@payana/contracts';
import { CurrentUser, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { AccountService } from '../application/account.service.js';
import { ConsentDto, DeletionRequestDto, EmergencyContactDto, SavedPlaceDto, UpdateMeDto } from './identity.dto.js';

/** Everything here acts on the caller's own account - the user id never comes from the URL. */
@ApiTags('me')
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(private readonly accounts: AccountService) {}

  @Get(ApiRoutes.me.root)
  @ApiContract({ summary: 'The signed-in account', response: 'Me' })
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.accounts.getMe(user.id);
  }

  @Patch(ApiRoutes.me.root)
  @ApiContract({ summary: 'Update name, email or language', body: 'UpdateMeRequest', response: 'Me' })
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto): Promise<Me> {
    return this.accounts.update(user, body);
  }

  @Get(ApiRoutes.me.emergencyContact)
  @ApiContract({ summary: 'Emergency contact', response: 'EmergencyContact', nullable: true })
  getEmergencyContact(@CurrentUser() user: AuthUser): Promise<EmergencyContact | null> {
    return this.accounts.getEmergencyContact(user.id);
  }

  @Put(ApiRoutes.me.emergencyContact)
  @ApiContract({ summary: 'Set the emergency contact', body: 'EmergencyContact', response: 'EmergencyContact' })
  putEmergencyContact(@CurrentUser() user: AuthUser, @Body() body: EmergencyContactDto): Promise<EmergencyContact> {
    return this.accounts.putEmergencyContact(user.id, body);
  }

  @Delete(ApiRoutes.me.emergencyContact)
  @HttpCode(204)
  @ApiContract({ summary: 'Remove the emergency contact' })
  deleteEmergencyContact(@CurrentUser() user: AuthUser): Promise<void> {
    return this.accounts.deleteEmergencyContact(user.id);
  }

  @Get(ApiRoutes.me.savedPlaces)
  @ApiContract({ summary: 'Saved places', response: 'SavedPlace', array: true })
  listSavedPlaces(@CurrentUser() user: AuthUser): Promise<SavedPlace[]> {
    return this.accounts.listSavedPlaces(user.id);
  }

  @Post(ApiRoutes.me.savedPlaces)
  @ApiContract({ summary: 'Save a place', body: 'SavedPlaceInput', response: 'SavedPlace', status: 201 })
  addSavedPlace(@CurrentUser() user: AuthUser, @Body() body: SavedPlaceDto): Promise<SavedPlace> {
    return this.accounts.addSavedPlace(user.id, body);
  }

  @Put(r(ApiRoutes.me.savedPlace(':placeId')))
  @ApiContract({ summary: 'Update a saved place', body: 'SavedPlaceInput', response: 'SavedPlace' })
  updateSavedPlace(
    @CurrentUser() user: AuthUser,
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Body() body: SavedPlaceDto,
  ): Promise<SavedPlace> {
    return this.accounts.updateSavedPlace(user.id, placeId, body);
  }

  @Delete(r(ApiRoutes.me.savedPlace(':placeId')))
  @HttpCode(204)
  @ApiContract({ summary: 'Remove a saved place' })
  deleteSavedPlace(@CurrentUser() user: AuthUser, @Param('placeId', ParseUUIDPipe) placeId: string): Promise<void> {
    return this.accounts.deleteSavedPlace(user.id, placeId);
  }

  @Get(ApiRoutes.me.consents)
  @ApiContract({ summary: 'Consent preferences', response: 'ConsentPreferences' })
  getConsents(@CurrentUser() user: AuthUser): Promise<ConsentPreferences> {
    return this.accounts.getConsents(user.id);
  }

  @Put(ApiRoutes.me.consents)
  @ApiContract({ summary: 'Record consent preferences', body: 'ConsentPreferencesInput', response: 'ConsentPreferences' })
  putConsents(@CurrentUser() user: AuthUser, @Body() body: ConsentDto): Promise<ConsentPreferences> {
    return this.accounts.putConsents(user, body);
  }

  @Get(ApiRoutes.me.deletionRequest)
  @ApiContract({ summary: 'Account deletion status', response: 'DeletionRequestStatus' })
  getDeletion(@CurrentUser() user: AuthUser): Promise<DeletionRequestStatus> {
    return this.accounts.getDeletionStatus(user.id);
  }

  @Post(ApiRoutes.me.deletionRequest)
  @HttpCode(200)
  @ApiContract({ summary: 'Ask for the account to be deleted', body: 'DeletionRequestInput', response: 'DeletionRequestStatus' })
  requestDeletion(@CurrentUser() user: AuthUser, @Body() body: DeletionRequestDto): Promise<DeletionRequestStatus> {
    return this.accounts.requestDeletion(user, body.reason);
  }

  @Delete(ApiRoutes.me.deletionRequest)
  @ApiContract({ summary: 'Cancel a pending deletion request', response: 'DeletionRequestStatus' })
  cancelDeletion(@CurrentUser() user: AuthUser): Promise<DeletionRequestStatus> {
    return this.accounts.cancelDeletion(user);
  }
}
