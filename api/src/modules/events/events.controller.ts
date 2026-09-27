import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { EventsService } from './events.service';
import { InvitesService } from '../invites/invites.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpsertRsvpDto } from './dto/upsert-rsvp.dto';
import { CreateGuestLinkDto } from './dto/create-guest-link.dto';
import { CreatePublicRsvpDto } from './dto/create-public-rsvp.dto';
import { UseGuestLinkDto } from './dto/use-guest-link.dto';
import { CreateEventInviteDto } from './dto/create-event-invite.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { AddWalkinDto } from './dto/add-walkin.dto';
import { AddGoingDto } from './dto/add-going.dto';
import { FacebookSyncDto } from './dto/facebook-sync.dto';
import { FacebookSyncService } from './facebook-sync.service';
import { SetReservationDto } from './dto/set-reservation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { EventStatus } from '../../database/entities/event.entity';

@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly invitesService: InvitesService,
    private readonly facebookSyncService: FacebookSyncService,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  findAll(
    @Query('cityId') cityId?: string,
    @Query('upcoming') upcoming?: string,
    @Query('fromDate') fromDate?: string,
    @Query('status') status?: EventStatus,
    @CurrentUser() user?: UserEntity,
  ) {
    const isAdminOrMod =
      user?.role === UserRole.ADMIN || user?.role === UserRole.MODERATOR;

    return this.eventsService.findAll({
      cityId: cityId ? parseInt(cityId, 10) : undefined,
      fromDate: fromDate || undefined,
      upcoming: fromDate ? undefined : (upcoming === 'true' ? true : upcoming === 'false' ? false : undefined),
      status: isAdminOrMod ? status : undefined,
      isAdminOrMod,
      userId: user?.id,
      callerRole: user?.role,
    });
  }

  @Get(':id/ics')
  async downloadIcs(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.eventsService.generateIcs(id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dinnerbears-event-${id}.ics"`);
    res.end(ics);
  }

  @Get('guest-ics/:token')
  async downloadGuestIcs(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const { ics, eventId } = await this.eventsService.generateGuestIcs(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dinnerbears-event-${eventId}.ics"`);
    res.end(ics);
  }

  @Get('guest-link/:token')
  getGuestLink(@Param('token') token: string) {
    return this.eventsService.getGuestLink(token);
  }

  @Post('guest-link/:token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  useGuestLink(@Param('token') token: string, @Body() dto: UseGuestLinkDto) {
    return this.eventsService.useGuestLink(token, dto.guestName);
  }

  @Delete('guest-link/:token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  cancelGuestRsvp(@Param('token') token: string) {
    return this.eventsService.cancelGuestRsvp(token);
  }

  @Delete(':id/rsvp/link/:linkId')
  @UseGuards(JwtAuthGuard)
  removeGuestLink(
    @Param('id', ParseIntPipe) _id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.removeGuestLink(linkId, user.id);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: UserEntity) {
    return this.eventsService.findOne(id, user?.role, user?.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: UserEntity) {
    return this.eventsService.create(dto, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.update(id, dto, user.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.remove(id);
  }

  @Post(':id/public-rsvp')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async publicRsvp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePublicRsvpDto,
  ) {
    await this.eventsService.createPublicRsvp(id, dto.name, dto.email);
    return { success: true };
  }

  @Post(':id/rsvp')
  @UseGuards(JwtAuthGuard)
  rsvp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertRsvpDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.upsertRsvp(id, user.id, dto.status, dto.additionalGuests, dto.guestNames, dto.bringingItem, user.role);
  }

  @Delete(':id/rsvp')
  @UseGuards(JwtAuthGuard)
  unrsvp(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserEntity) {
    return this.eventsService.removeRsvp(id, user.id);
  }

  @Post(':id/rsvp/link')
  @UseGuards(JwtAuthGuard)
  generateGuestLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateGuestLinkDto,
    @CurrentUser() user: UserEntity,
  ) {
    if (user.role === UserRole.NON_VALIDATED) {
      throw new ForbiddenException('Non-validated members cannot invite guests');
    }
    return this.eventsService.generateGuestLink(id, user.id, dto.recipientName, dto.recipientEmail);
  }

  // Event invite links (admin only — for /join/:code flow)
  @Get(':id/invite-links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getEventInviteLinks(@Param('id', ParseIntPipe) id: number) {
    return this.invitesService.findByEvent(id);
  }

  @Post(':id/invite-links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  createEventInviteLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEventInviteDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.invitesService.createEventInvite(id, dto.flavor, user);
  }

  @Patch(':id/invite-links/:inviteId/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  revokeEventInviteLink(
    @Param('inviteId', ParseIntPipe) inviteId: number,
  ) {
    return this.invitesService.revoke(inviteId);
  }

  @Get(':id/attendance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  getAttendance(@Param('id', ParseIntPipe) id: number) {
    return this.eventsService.getAttendance(id);
  }

  @Patch(':id/attendance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  markAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.eventsService.markAttendance(id, dto.attendances);
  }

  @Patch('guest-links/:guestLinkId/attendance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  markGuestAttendance(
    @Param('guestLinkId', ParseIntPipe) guestLinkId: number,
    @Body() body: { attended: boolean },
  ) {
    return this.eventsService.markGuestAttendance(guestLinkId, body.attended);
  }

  @Post('guest-links/:guestLinkId/resend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  resendGuestInvite(@Param('guestLinkId', ParseIntPipe) guestLinkId: number) {
    return this.eventsService.resendGuestInvite(guestLinkId);
  }

  // Phase 39: an admin marks a member Going on their behalf (the RSVP
  // counterpart of Add Walk-in). Admin-only — moderators can add walk-ins at
  // the door but not RSVP for people.
  @Post(':id/attendance/going')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  addGoing(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGoingDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.addGoingByAdmin(id, dto.userId, dto.additionalGuests ?? 0, user.id);
  }

  // Phase 39: reconcile this event's RSVPs with the Facebook event's Going
  // list. See FacebookSyncService for the rules.
  @Post(':id/facebook-sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  facebookSync(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FacebookSyncDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.facebookSyncService.sync(id, dto.attendees, user.id);
  }

  @Post(':id/attendance/walkin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  addWalkin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddWalkinDto,
  ) {
    return this.eventsService.addWalkin(id, dto.userId);
  }

  @Get('reservation-confirm/:token')
  getReservationInfo(@Param('token') token: string) {
    return this.eventsService.getReservationInfo(token);
  }

  @Patch(':id/reservation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  setReservation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetReservationDto,
    @CurrentUser() user: UserEntity,
  ) {
    return this.eventsService.setReservation(id, dto, user);
  }

  @Post('reservation-confirm/:token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  confirmReservation(@Param('token') token: string) {
    return this.eventsService.confirmReservation(token);
  }

  @Get(':id/members/search')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR, UserRole.ADMIN)
  searchMembers(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') q: string,
    @Query('excludeGoing') excludeGoing?: string,
  ) {
    // Shared by the walk-in search (should exclude members already RSVP'd
    // Going — they're already on the list) and the reservation-coordinator
    // search (should NOT exclude them — the coordinator is very often
    // already Going to their own event). Default true preserves the
    // original walk-in-only behavior for any other caller.
    return this.eventsService.searchMembersForWalkin(id, q ?? '', excludeGoing !== 'false');
  }
}
