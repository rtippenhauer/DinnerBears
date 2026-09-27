import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiTokenEntity } from '../../database/entities/api-token.entity';
import { InviteEntity } from '../../database/entities/invite.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { EventsModule } from '../events/events.module';
import { FacebookModule } from '../facebook/facebook.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InvitesModule } from '../invites/invites.module';
import { LocationsModule } from '../locations/locations.module';
import { MuseController } from './muse.controller';
import { MuseService } from './muse.service';
import { MuseTokenGuard } from './muse-token.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiTokenEntity, InviteEntity, UserEntity]),
    AuditModule,
    EventsModule,
    FacebookModule,
    IntegrationsModule,
    InvitesModule,
    LocationsModule,
  ],
  providers: [MuseService, MuseTokenGuard],
  controllers: [MuseController],
})
export class MuseModule {}
