import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { SetSyncHostDto } from './dto/set-sync-host.dto';

@Controller('admin/integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IntegrationsAdminController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async list() {
    const [integrations, syncHost] = await Promise.all([
      this.integrationsService.list(),
      this.integrationsService.getSyncHost(),
    ]);
    return { integrations, syncHost };
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: UserEntity) {
    return this.integrationsService.create(dto.name, dto.role ?? UserRole.MUSE, user.id);
  }

  @Post(':userId/token')
  regenerate(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: UserEntity) {
    return this.integrationsService.regenerate(userId, user.id);
  }

  @Delete(':userId/token')
  async revoke(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: UserEntity) {
    await this.integrationsService.revoke(userId, user.id);
    return { success: true };
  }

  @Put('sync-host')
  setSyncHost(@Body() dto: SetSyncHostDto, @CurrentUser() user: UserEntity) {
    return this.integrationsService.setSyncHost(dto.userId, user.id);
  }
}
