import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccountRole,
  ApiRoutes,
  Permission,
  REVIEW_COMMENT_MAX_LENGTH,
  ReviewStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  type AddTicketMessageRequest,
  type CreateTicketRequest,
  type NotificationList,
  type Paginated,
  type ReplyToReviewRequest,
  type Review,
  type SubmitReviewRequest,
  type SupportTicket,
  type TicketListQuery,
} from '@payana/contracts';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, Public, RequirePermission, Roles, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { PageQueryDto } from '../../../common/http/pagination.js';
import { r } from '../../../common/http/route.js';
import { toBool } from '../../../common/http/validators.js';
import { NotificationsService } from '../application/notifications.service.js';
import { ReviewsService } from '../application/reviews.service.js';
import { SupportService } from '../application/support.service.js';

class SubmitReviewDto implements SubmitReviewRequest {
  @IsInt() @Min(1) @Max(5)
  rating!: number;

  @IsOptional() @IsString() @MaxLength(REVIEW_COMMENT_MAX_LENGTH)
  comment?: string;
}

class ReplyToReviewDto implements ReplyToReviewRequest {
  @IsString() @Length(2, 600)
  text!: string;
}

class ModerateReviewDto {
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

class NotificationQueryDto {
  @IsOptional() @Transform(toBool) @IsBoolean()
  unreadOnly?: boolean;
}

class CreateTicketDto implements CreateTicketRequest {
  @IsEnum(TicketCategory)
  category!: TicketCategory;

  @IsString() @Length(4, 120)
  subject!: string;

  @IsString() @Length(10, 4000)
  body!: string;

  @IsOptional() @IsUUID()
  bookingId?: string;
}

class AddTicketMessageDto implements AddTicketMessageRequest {
  @IsString() @Length(1, 4000)
  body!: string;
}

class TicketListQueryDto extends PageQueryDto implements TicketListQuery {
  @IsOptional() @IsEnum(TicketStatus)
  status?: TicketStatus;
}

class UpdateTicketDto {
  @IsOptional() @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional() @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get(r(ApiRoutes.drivers.reviews(':driverId')))
  @ApiContract({ summary: 'Published reviews of a driver', response: 'Review', paginated: true })
  list(@Param('driverId', ParseUUIDPipe) driverId: string, @Query() q: PageQueryDto): Promise<Paginated<Review>> {
    return this.reviews.listForDriver(driverId, q);
  }

  @Post(r(ApiRoutes.bookings.review(':bookingId')))
  @Roles(AccountRole.Customer)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Review a completed trip', body: 'SubmitReviewRequest', response: 'Review', status: 201 })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() body: SubmitReviewDto,
  ): Promise<Review> {
    return this.reviews.submit(user, bookingId, body);
  }

  @Post(r(ApiRoutes.driver.replyToReview(':reviewId')))
  @HttpCode(200)
  @Roles(AccountRole.Driver)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Reply publicly to a review', body: 'ReplyToReviewRequest', response: 'Review' })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() body: ReplyToReviewDto,
  ): Promise<Review> {
    return this.reviews.reply(user, reviewId, body.text);
  }

  @Post(r(ApiRoutes.admin.moderateReview(':reviewId')))
  @HttpCode(200)
  @RequirePermission(Permission.ReviewsModerate)
  @ApiBearerAuth()
  @ApiContract({ summary: 'Hide or republish a review', response: 'Review' })
  moderate(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() body: ModerateReviewDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<Review> {
    return this.reviews.moderate(reviewId, body.status, body.reason, actor);
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get(ApiRoutes.notifications.root)
  @ApiContract({ summary: 'The caller’s notifications and unread count', response: 'NotificationList' })
  list(@CurrentUser() user: AuthUser, @Query() q: NotificationQueryDto): Promise<NotificationList> {
    return this.notifications.list(user.id, q.unreadOnly === true);
  }

  @Post(ApiRoutes.notifications.readAll)
  @HttpCode(204)
  @ApiContract({ summary: 'Mark every notification as read' })
  readAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Post(r(ApiRoutes.notifications.read(':notificationId')))
  @HttpCode(204)
  @ApiContract({ summary: 'Mark one notification as read' })
  read(@CurrentUser() user: AuthUser, @Param('notificationId', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }
}

@ApiTags('support')
@ApiBearerAuth()
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get(ApiRoutes.support.tickets)
  @ApiContract({ summary: 'The caller’s support tickets', response: 'SupportTicket', paginated: true })
  list(@CurrentUser() user: AuthUser, @Query() q: TicketListQueryDto): Promise<Paginated<SupportTicket>> {
    return this.support.listOwn(user, q);
  }

  @Post(ApiRoutes.support.tickets)
  @ApiContract({ summary: 'Open a support ticket or report an issue', body: 'CreateTicketRequest', response: 'SupportTicket', status: 201 })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTicketDto): Promise<SupportTicket> {
    return this.support.create(user, body);
  }

  @Get(r(ApiRoutes.support.ticket(':ticketId')))
  @ApiContract({ summary: 'One of the caller’s tickets', response: 'SupportTicket' })
  one(@CurrentUser() user: AuthUser, @Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<SupportTicket> {
    return this.support.getOwn(user, ticketId);
  }

  @Post(r(ApiRoutes.support.messages(':ticketId')))
  @HttpCode(200)
  @ApiContract({ summary: 'Reply on a ticket', body: 'AddTicketMessageRequest', response: 'SupportTicket' })
  reply(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: AddTicketMessageDto,
  ): Promise<SupportTicket> {
    return this.support.addUserMessage(user, ticketId, body.body);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get(ApiRoutes.admin.tickets)
  @RequirePermission(Permission.SupportManage)
  @ApiContract({ summary: 'Support queue, most urgent first', response: 'SupportTicket', paginated: true })
  list(@Query() q: TicketListQueryDto): Promise<Paginated<SupportTicket>> {
    return this.support.adminList(q);
  }

  @Get(r(ApiRoutes.admin.ticket(':ticketId')))
  @RequirePermission(Permission.SupportManage)
  @ApiContract({ summary: 'A ticket', response: 'SupportTicket' })
  one(@Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<SupportTicket> {
    return this.support.adminGet(ticketId);
  }

  @Patch(r(ApiRoutes.admin.ticket(':ticketId')))
  @RequirePermission(Permission.SupportManage)
  @ApiContract({ summary: 'Change a ticket’s status or priority', response: 'SupportTicket' })
  update(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: UpdateTicketDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<SupportTicket> {
    return this.support.adminUpdate(ticketId, body, actor);
  }

  @Post(r(ApiRoutes.admin.ticketMessages(':ticketId')))
  @HttpCode(200)
  @RequirePermission(Permission.SupportManage)
  @ApiContract({ summary: 'Reply to the user as support', body: 'AddTicketMessageRequest', response: 'SupportTicket' })
  reply(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: AddTicketMessageDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<SupportTicket> {
    return this.support.addSupportMessage(ticketId, body.body, actor);
  }
}
