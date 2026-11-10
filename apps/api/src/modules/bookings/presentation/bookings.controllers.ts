import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccountRole,
  ApiRoutes,
  BookingStatus,
  CancellationReason,
  MAX_PASSENGERS,
  Permission,
  RideRequestStatus,
  TripType,
  type AdminBookingQuery,
  type AdminBookingRow,
  type Booking,
  type BookingListQuery,
  type CancelBookingRequest,
  type CreateRideRequest,
  type DriverMetrics,
  type DriverRequestFeedItem,
  type Paginated,
  type Quote,
  type Receipt,
  type ResolveDisputeRequest,
  type RideRequest,
  type RideRequestListQuery,
  type SubmitQuoteRequest,
  type TransitionBookingRequest,
} from '@payana/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, RequirePermission, Roles, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { r } from '../../../common/http/route.js';
import { DATE_ONLY, PlaceDto } from '../../../common/http/validators.js';
import { Idempotent } from '../../../common/idempotency/idempotency.js';
import { MarketplaceFacade } from '../../marketplace/application/marketplace.facade.js';
import { BookingsService } from '../application/bookings.service.js';
import { RequestsService } from '../application/requests.service.js';

class CreateRideRequestDto implements CreateRideRequest {
  @IsEnum(TripType)
  tripType!: TripType;

  @ValidateNested() @Type(() => PlaceDto)
  pickup!: PlaceDto;

  @IsOptional() @ValidateNested() @Type(() => PlaceDto)
  drop?: PlaceDto;

  @IsOptional() @IsISO8601({ strict: true })
  scheduledAt?: string;

  @IsOptional() @IsISO8601({ strict: true })
  returnAt?: string;

  @Matches(/^[a-z][a-z0-9_]{1,39}$/)
  categoryCode!: string;

  @IsInt() @Min(1) @Max(MAX_PASSENGERS)
  passengers!: number;

  @IsOptional() @IsInt() @Min(0) @Max(40)
  luggage?: number;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @IsOptional() @IsUUID()
  packageId?: string;

  @IsOptional() @IsUUID()
  targetDriverId?: string;
}

class RideRequestListQueryDto extends PageQueryDto implements RideRequestListQuery {
  @IsOptional() @IsEnum(RideRequestStatus)
  status?: RideRequestStatus;
}

class SubmitQuoteDto implements SubmitQuoteRequest {
  @IsUUID()
  vehicleId!: string;

  @IsInt() @Min(100) @Max(10_000_000)
  fareMinor!: number;

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 60, { each: true })
  inclusions?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 60, { each: true })
  exclusions?: string[];

  @IsOptional() @IsString() @MaxLength(240)
  pickupNote?: string;

  @IsOptional() @IsInt() @Min(1) @Max(240)
  etaMinutes?: number;

  @IsInt() @Min(5) @Max(1440)
  validForMinutes!: number;
}

class BookingListQueryDto extends PageQueryDto implements BookingListQuery {
  @IsOptional() @IsIn(['active', 'past', 'all'])
  scope?: 'active' | 'past' | 'all';
}

class CancelBookingDto implements CancelBookingRequest {
  @IsEnum(CancellationReason)
  reason!: CancellationReason;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

class TransitionBookingDto implements TransitionBookingRequest {
  @IsEnum(BookingStatus)
  to!: BookingStatus;
}

class MetricsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(90)
  periodDays?: number;
}

class AdminBookingQueryDto extends PageQueryDto implements AdminBookingQuery {
  @IsOptional() @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @Matches(DATE_ONLY)
  from?: string;

  @IsOptional() @Matches(DATE_ONLY)
  to?: string;
}

class ResolveDisputeDto implements ResolveDisputeRequest {
  @IsIn(['completed', 'cancelled_by_admin'])
  outcome!: 'completed' | 'cancelled_by_admin';

  @IsString() @Length(5, 1000)
  note!: string;
}

/** The customer's side: ask for a ride, compare quotes, accept one. */
@ApiTags('ride-requests')
@ApiBearerAuth()
@Roles(AccountRole.Customer)
@Controller()
export class RideRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get(ApiRoutes.rideRequests.root)
  @ApiContract({ summary: 'The caller’s ride requests', response: 'RideRequest', paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() q: RideRequestListQueryDto): Promise<Paginated<RideRequest>> {
    return this.requests.list(user, q);
  }

  @Post(ApiRoutes.rideRequests.root)
  @Idempotent()
  @ApiContract({ summary: 'Ask for a ride', body: 'CreateRideRequest', response: 'RideRequest', status: 201, idempotent: true })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRideRequestDto): Promise<RideRequest> {
    return this.requests.create(user, body);
  }

  @Get(r(ApiRoutes.rideRequests.one(':requestId')))
  @ApiContract({ summary: 'A ride request with its quotes', response: 'RideRequest' })
  one(@CurrentUser() user: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<RideRequest> {
    return this.requests.get(user, requestId);
  }

  @Post(r(ApiRoutes.rideRequests.cancel(':requestId')))
  @HttpCode(200)
  @ApiContract({ summary: 'Withdraw a ride request', response: 'RideRequest' })
  cancel(@CurrentUser() user: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<RideRequest> {
    return this.requests.cancel(user, requestId);
  }

  @Post(r(ApiRoutes.rideRequests.acceptQuote(':requestId', ':quoteId')))
  @Idempotent()
  @ApiContract({ summary: 'Accept a quote - creates the booking', response: 'Booking', status: 201, idempotent: true })
  acceptQuote(
    @CurrentUser() user: AuthUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<Booking> {
    return this.requests.acceptQuote(user, requestId, quoteId);
  }
}

/** The partner's side: the request inbox, quotations, their bookings and their numbers. */
@ApiTags('driver')
@ApiBearerAuth()
@Roles(AccountRole.Driver)
@Controller()
export class DriverRequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly bookings: BookingsService,
    private readonly marketplace: MarketplaceFacade,
  ) {}

  @Get(ApiRoutes.driver.requests)
  @ApiContract({ summary: 'Open ride requests this partner can quote on', response: 'DriverRequestFeedItem', paginated: true })
  feed(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto): Promise<Paginated<DriverRequestFeedItem>> {
    return this.requests.feed(user, q);
  }

  @Get(r(ApiRoutes.driver.request(':requestId')))
  @ApiContract({ summary: 'One request from the inbox', response: 'DriverRequestFeedItem' })
  feedItem(@CurrentUser() user: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<DriverRequestFeedItem> {
    return this.requests.feedItem(user, requestId);
  }

  @Post(r(ApiRoutes.driver.quotes(':requestId')))
  @Idempotent()
  @ApiContract({ summary: 'Send a quotation', body: 'SubmitQuoteRequest', response: 'Quote', status: 201, idempotent: true })
  submitQuote(
    @CurrentUser() user: AuthUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: SubmitQuoteDto,
  ): Promise<Quote> {
    return this.requests.submitQuote(user, requestId, body);
  }

  @Post(r(ApiRoutes.driver.withdrawQuote(':quoteId')))
  @HttpCode(200)
  @ApiContract({ summary: 'Withdraw a quotation', response: 'Quote' })
  withdrawQuote(@CurrentUser() user: AuthUser, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<Quote> {
    return this.requests.withdrawQuote(user, quoteId);
  }

  @Post(r(ApiRoutes.driver.declineRequest(':requestId')))
  @HttpCode(204)
  @ApiContract({ summary: 'Hide a request from the inbox' })
  decline(@CurrentUser() user: AuthUser, @Param('requestId', ParseUUIDPipe) requestId: string): Promise<void> {
    return this.requests.decline(user, requestId);
  }

  @Get(ApiRoutes.driver.bookings)
  @ApiContract({ summary: 'Bookings this partner is the driver of', response: 'Booking', paginated: true })
  bookingsList(@CurrentUser() user: AuthUser, @Query() q: BookingListQueryDto): Promise<Paginated<Booking>> {
    return this.bookings.listForDriver(user, q);
  }

  @Get(ApiRoutes.driver.metrics)
  @ApiContract({ summary: 'Performance over a rolling window (paid plans)', response: 'DriverMetrics' })
  async metrics(@CurrentUser() user: AuthUser, @Query() q: MetricsQueryDto): Promise<DriverMetrics> {
    const profile = await this.marketplace.profileOf(user);
    return this.bookings.metrics(user, q.periodDays ?? 30, (since) =>
      profile ? this.requests.countEnquiries(profile, since) : Promise.resolve(0),
    );
  }
}

/** Bookings as seen by either party. Who the caller is to the booking is decided in the service. */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(ApiRoutes.bookings.root)
  @Roles(AccountRole.Customer)
  @ApiContract({ summary: 'The caller’s bookings as a customer', response: 'Booking', paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() q: BookingListQueryDto): Promise<Paginated<Booking>> {
    return this.bookings.listForCustomer(user, q);
  }

  @Get(r(ApiRoutes.bookings.one(':bookingId')))
  @Roles(AccountRole.Customer, AccountRole.Driver)
  @ApiContract({ summary: 'A booking, for its customer or its driver', response: 'Booking' })
  one(@CurrentUser() user: AuthUser, @Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<Booking> {
    return this.bookings.getForParty(user, bookingId);
  }

  @Post(r(ApiRoutes.bookings.cancel(':bookingId')))
  @HttpCode(200)
  @Roles(AccountRole.Customer, AccountRole.Driver)
  @ApiContract({ summary: 'Cancel a booking', body: 'CancelBookingRequest', response: 'Booking' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: CancelBookingDto,
  ): Promise<Booking> {
    return this.bookings.cancel(user, bookingId, body);
  }

  @Post(r(ApiRoutes.bookings.transition(':bookingId')))
  @HttpCode(200)
  @Roles(AccountRole.Driver)
  @ApiContract({ summary: 'Move a booking to its next status (driver)', body: 'TransitionBookingRequest', response: 'Booking' })
  transition(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: TransitionBookingDto,
  ): Promise<Booking> {
    return this.bookings.transition(user, bookingId, body.to);
  }

  @Get(r(ApiRoutes.bookings.receipt(':bookingId')))
  @Roles(AccountRole.Customer, AccountRole.Driver)
  @ApiContract({ summary: 'Receipt for a completed booking', response: 'Receipt' })
  receipt(@CurrentUser() user: AuthUser, @Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<Receipt> {
    return this.bookings.receipt(user, bookingId);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(ApiRoutes.admin.bookings)
  @RequirePermission(Permission.BookingsRead)
  @ApiContract({ summary: 'Search bookings', response: 'AdminBookingRow', paginated: true })
  list(@Query() q: AdminBookingQueryDto): Promise<Paginated<AdminBookingRow>> {
    return this.bookings.adminList(q);
  }

  @Get(r(ApiRoutes.admin.booking(':bookingId')))
  @RequirePermission(Permission.BookingsRead)
  @ApiContract({ summary: 'A booking in full', response: 'Booking' })
  one(@Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<Booking> {
    return this.bookings.getForAdmin(bookingId);
  }

  @Post(r(ApiRoutes.admin.resolveDispute(':bookingId')))
  @HttpCode(200)
  @RequirePermission(Permission.BookingsResolve)
  @ApiContract({ summary: 'Resolve a disputed booking', body: 'ResolveDisputeRequest', response: 'Booking' })
  resolve(
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: ResolveDisputeDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Booking> {
    return this.bookings.resolveDispute(bookingId, body, actor);
  }
}
