import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../../database/entities/event.entity';
import { EventGuestLinkEntity } from '../../database/entities/event-guest-link.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { InviteEntity } from '../../database/entities/invite.entity';
import { LocationEntity } from '../../database/entities/location.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { EmailModule } from '../email/email.module';
import { InvitesModule } from '../invites/invites.module';
import { CalendarModule } from '../calendar/calendar.module';
import { CommunityModule } from '../community/community.module';
import { LocationsModule } from '../locations/locations.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacebookSyncService } from './facebook-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventEntity, EventRsvpEntity, EventGuestLinkEntity, InviteEntity, LocationEntity, UserEntity]),
    EmailModule,
    InvitesModule,
    CalendarModule,
    CommunityModule,
    LocationsModule,
    AppConfigModule,
    AuditModule,
    IntegrationsModule,
  ],
  providers: [EventsService, FacebookSyncService],
  controllers: [EventsController],
  exports: [EventsService, FacebookSyncService],
})
export class EventsModule {}
