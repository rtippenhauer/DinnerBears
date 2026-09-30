import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from '../../database/entities/event.entity';
import { EventFacebookLinkEntity } from '../../database/entities/event-facebook-link.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { FacebookAccountEntity } from '../../database/entities/facebook-account.entity';
import { FacebookEventAttendeeEntity } from '../../database/entities/facebook-event-attendee.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { CalendarModule } from '../calendar/calendar.module';
import { EventsModule } from '../events/events.module';
import { FacebookAccountsService } from './facebook-accounts.service';
import { FacebookAdminController } from './facebook-admin.controller';
import { FacebookSyncService } from './facebook-sync.service';
import { FacebookReconcileService } from './facebook-reconcile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EventEntity,
      EventFacebookLinkEntity,
      EventRsvpEntity,
      FacebookAccountEntity,
      FacebookEventAttendeeEntity,
      UserEntity,
    ]),
    AuditModule,
    CalendarModule,
    EventsModule,
  ],
  providers: [FacebookAccountsService, FacebookSyncService, FacebookReconcileService],
  controllers: [FacebookAdminController],
  exports: [FacebookAccountsService, FacebookSyncService],
})
export class FacebookModule {}
