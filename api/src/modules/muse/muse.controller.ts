import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { EventsService } from '../events/events.service';
import { FacebookSyncService } from '../facebook/facebook-sync.service';
import { FacebookSyncDto, LinkFacebookEventDto } from '../facebook/dto/facebook-sync.dto';
import { LocationsService } from '../locations/locations.service';
import { CreateEventInviteDto } from '../events/dto/create-event-invite.dto';
import { IntegrationsService } from '../integrations/integrations.service';
import { MuseTokenGuard, type MuseRequest } from './muse-token.guard';
import { MuseService } from './muse.service';

// Phase 39: everything the Muse Facebook sync can do, and nothing else —
// events, locations and members are read-only; Facebook events can be linked
// to a dinner; RSVPs change only through the Facebook sync; invite links can
// be listed, created and revoked. Thin
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
  async events(
    @CurrentUser() user: UserEntity,
    @Query('cityId') cityId?: string,
    @Query('fromDate') fromDate?: string,
  ) {
    const events = await this.eventsService.findAll({
      cityId: cityId ? parseInt(cityId, 10) : undefined,
      fromDate: fromDate || undefined,
      upcoming: fromDate ? undefined : true,
      isAdminOrMod: true, // include drafts, so Muse sees an event before it's published
      userId: user.id,
      callerRole: UserRole.MUSE,
    });
    const links = await this.facebookSyncService.linksFor(events.map((e) => e.id));
    return events.map((e) => Object.assign(e, { facebookEvents: links.get(e.id) ?? [] }));
  }

  @Get('events/:id')
  async event(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    const event = await this.eventsService.findOne(id, UserRole.MUSE, user.id);
    const links = await this.facebookSyncService.linksFor([id]);
    return Object.assign(event, { facebookEvents: links.get(id) ?? [] });
  }

  // ── Facebook events linked to a dinner ────────────────────────────────────

  // Link (or re-group) a Facebook event. Safe to repeat. 409 if that Facebook
  // event is already linked to a different dinner.
  @Put('events/:id/facebook-events/:facebookEventId')
  linkFacebookEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('facebookEventId') facebookEventId: string,
    @Body() dto: LinkFacebookEventDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.facebookSyncService.linkFacebookEvent(id, this.checkFacebookEventId(facebookEventId), dto.group, user.id);
  }

  @Delete('events/:id/facebook-events/:facebookEventId')
  unlinkFacebookEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('facebookEventId') facebookEventId: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.facebookSyncService.unlinkFacebookEvent(id, this.checkFacebookEventId(facebookEventId), user.id);
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

  // Everyone with an RSVP (any status), public guest signups, Facebook-only
  // attendees, and the merged headcount.
  @Get('events/:id/attendees')
  attendees(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.getAttendeeList(id);
  }

  // ── Facebook sync ─────────────────────────────────────────────────────────

  // Several Facebook events in one call (Muse's extraction, as-is). All lists
  // are applied before any dinner is reconciled or counted, so each Facebook
  // event gets back its dinner's final merged headcount.
  @Post('facebook-sync')
  @HttpCode(200)
  facebookSync(@Body() dto: FacebookSyncDto, @CurrentUser() user: UserEntity) {
    return this.facebookSyncService.sync(dto, user.id);
  }

  private checkFacebookEventId(id: string): string {
    if (!/^\d{1,32}$/.test(id)) {
      throw new BadRequestException('facebookEventId must be the digits from the Facebook event URL');
    }
    return id;
  }
}
