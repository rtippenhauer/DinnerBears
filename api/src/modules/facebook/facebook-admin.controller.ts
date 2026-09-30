import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsPositive } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { FacebookAccountStatus } from '../../database/entities/facebook-account.entity';
import { FacebookAccountsService } from './facebook-accounts.service';

export class LinkFacebookAccountDto {
  @IsInt()
  @IsPositive()
  userId: number;
}

// Phase 39: Admin → Facebook Accounts — review the Facebook people the sync
// has seen and tie each to a member (or mark them not a member).
@Controller('admin/facebook-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class FacebookAdminController {
  constructor(private readonly accountsService: FacebookAccountsService) {}

  @Get()
  list(@Query('status') status?: string) {
    const valid = Object.values(FacebookAccountStatus) as string[];
    return this.accountsService.list(status && valid.includes(status) ? (status as FacebookAccountStatus) : undefined);
  }

  @Post(':id/link')
  link(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkFacebookAccountDto, @CurrentUser() user: UserEntity) {
    return this.accountsService.link(id, dto.userId, user.id);
  }

  @Post(':id/unlink')
  unlink(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.accountsService.unlink(id, user.id);
  }

  @Post(':id/not-member')
  notMember(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.accountsService.markNotMember(id, user.id);
  }
}
