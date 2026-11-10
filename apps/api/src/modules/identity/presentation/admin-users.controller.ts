import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiRoutes, Permission, type AdminUserRow, type Paginated, type StaffMember } from '@payana/contracts';
import { CurrentUser, RequirePermission, type AuthUser } from '../../../common/auth/auth.types.js';
import { ApiContract } from '../../../common/http/api-contract.js';
import { r } from '../../../common/http/route.js';
import { UsersAdminService } from '../application/users-admin.service.js';
import { AdminUserQueryDto, CreateStaffDto, SuspendUserDto, UpdateStaffDto } from './identity.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminUsersController {
  constructor(private readonly users: UsersAdminService) {}

  @Get(ApiRoutes.admin.users)
  @RequirePermission(Permission.UsersRead)
  @ApiContract({ summary: 'Search accounts', response: 'AdminUserRow', paginated: true })
  list(@Query() q: AdminUserQueryDto): Promise<Paginated<AdminUserRow>> {
    return this.users.list(q);
  }

  @Post(r(ApiRoutes.admin.suspendUser(':userId')))
  @HttpCode(200)
  @RequirePermission(Permission.UsersSuspend)
  @ApiContract({ summary: 'Suspend an account', body: 'SuspendUserRequest', response: 'AdminUserRow' })
  suspend(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SuspendUserDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminUserRow> {
    return this.users.suspend(userId, body.reason, actor);
  }

  @Post(r(ApiRoutes.admin.reinstateUser(':userId')))
  @HttpCode(200)
  @RequirePermission(Permission.UsersSuspend)
  @ApiContract({ summary: 'Lift a suspension', response: 'AdminUserRow' })
  reinstate(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() actor: AuthUser): Promise<AdminUserRow> {
    return this.users.reinstate(userId, actor);
  }

  @Get(ApiRoutes.admin.staff)
  @RequirePermission(Permission.StaffManage)
  @ApiContract({ summary: 'List staff members', response: 'StaffMember', array: true })
  listStaff(): Promise<StaffMember[]> {
    return this.users.listStaff();
  }

  @Post(ApiRoutes.admin.staff)
  @RequirePermission(Permission.StaffManage)
  @ApiContract({ summary: 'Create a staff member', body: 'CreateStaffRequest', response: 'StaffMember', status: 201 })
  createStaff(@Body() body: CreateStaffDto, @CurrentUser() actor: AuthUser): Promise<StaffMember> {
    return this.users.createStaff(body, actor);
  }

  @Patch(r(ApiRoutes.admin.staffMember(':userId')))
  @RequirePermission(Permission.StaffManage)
  @ApiContract({ summary: 'Change a staff member’s role or status', body: 'UpdateStaffRequest', response: 'StaffMember' })
  updateStaff(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateStaffDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StaffMember> {
    return this.users.updateStaff(userId, body, actor);
  }
}
