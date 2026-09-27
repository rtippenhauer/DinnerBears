import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { EventsService } from '../events/events.service';
import { FacebookSyncService } from '../events/facebook-sync.service';
import { FacebookSyncDto } from '../events/dto/facebook-sync.dto';
import { LocationsService } from '../locations/locations.service';
import { CreateEventInviteDto } from '../events/dto/create-event-invite.dto';
import { IntegrationsService } from '../integrations/integrations.service';
import { MuseTokenGuard, type MuseRequest } from './muse-token.guard';
import { MuseService } from './muse.service';

// Phase 39: everything the Muse Facebook sync can do, and nothing else —
// events, locations and members are read-only; RSVPs change only through the
// Facebook sync; invite links can be listed, created and revoked. Thin
// wrappers over the existing services; see docs/MUSE_API.md. Every write is
// audited as the Muse account. Its own rate limit: a sync run can
// make many writes back to back, well past the global 30-writes/min fallback.
@Controller('muse')
@UseGuards(MuseTokenGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
export class MuseController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly eventsService: EventsService,
    private readonly facebookSyncService: FacebookSyncService,
    private readonly locationsService: LocationsService,
    private readonly museService: MuseService,
  ) {}

  // ── Token ──────────────────────────────────────────────────────────────────

  @Get('me')
  me(@CurrentUser() user: UserEntity, @Req() req: MuseRequest) {
    return this.integrationsService.describeSelf(user, req.apiTokenId);
  }

  // The old token stops working the moment this returns.
  @Post('token/rotate')
  @HttpCode(200)
  rotate(@CurrentUser() user: UserEntity, @Req() req: MuseRequest) {
    return this.integrationsService.rotate(user, req.apiTokenId);
  }

  // ── Members ────────────────────────────────────────────────────────────────

  @Get('users')
  users() {
    return this.museService.listMembers();
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  @Get('locations')
  locations(
    @CurrentUser() user: UserEntity,
    @Query('cityId') cityId?: string,
    @Query('search') search?: string,
  ) {
    return this.locationsService.findAllForUser({ cityId: cityId ? parseInt(cityId, 10) : undefined, search }, user);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  @Get('events')
  events(
    @CurrentUser() user: UserEntity,
    @Query('cityId') cityId?: string,
    @Query('fromDate') fromDate?: string,
  ) {
    return this.eventsService.findAll({
      cityId: cityId ? parseInt(cityId, 10) : undefined,
      fromDate: fromDate || undefined,
      upcoming: fromDate ? undefined : true,
      isAdminOrMod: true, // include drafts, so Muse sees an event before it's published
      userId: user.id,
      callerRole: UserRole.MUSE,
    });
  }

  @Get('events/:id')
  event(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.eventsService.findOne(id, UserRole.MUSE, user.id);
  }

  // ── Invite links (the event page's Share dialog) ──────────────────────────

  // Active link per flavor: `member` (full membership) and `nonValidated`
  // (requires validation), each with a ready-to-share /join URL.
  @Get('events/:id/invite-links')
  inviteLinks(@Param('id', ParseIntPipe) id: number) {
    return this.museService.getInviteLinks(id);
  }

  @Post('events/:id/invite-links')
  createInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEventInviteDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.museService.createInviteLink(id, dto.flavor, user);
  }

  @Patch('events/:id/invite-links/:inviteId/revoke')
  revokeInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('inviteId', ParseIntPipe) inviteId: number,
    @CurrentUser() user: UserEntity,
  ) {
    return this.museService.revokeInviteLink(id, inviteId, user);
  }

  // ── Attendees ─────────────────────────────────────────────────────────────

  // Everyone with an RSVP (any status) plus public guest signups.
  @Get('events/:id/attendees')
  attendees(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.getAttendeeList(id);
  }

  // Reconcile RSVPs with the Facebook event's Going list — see
  // FacebookSyncService for the rules. Each change is audited there.
  @Post('events/:id/facebook-sync')
  @HttpCode(200)
  facebookSync(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FacebookSyncDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.facebookSyncService.sync(id, dto.attendees, user.id);
  }
}
