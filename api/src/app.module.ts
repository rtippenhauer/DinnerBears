import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerAuditGuard } from './common/guards/throttler-audit.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './modules/health/health.module';
import { CitiesModule } from './modules/cities/cities.module';
import { InvitesModule } from './modules/invites/invites.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FacebookGroupsModule } from './modules/facebook-groups/facebook-groups.module';
import { LocationsModule } from './modules/locations/locations.module';
import { EventsModule } from './modules/events/events.module';
import { AdminModule } from './modules/admin/admin.module';
import { StatsModule } from './modules/stats/stats.module';
import { EmailModule } from './modules/email/email.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { MuseModule } from './modules/muse/muse.module';
import { FacebookModule } from './modules/facebook/facebook.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { EventCommentsModule } from './modules/event-comments/event-comments.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CommunityModule } from './modules/community/community.module';
import { MerchModule } from './modules/merch/merch.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { AvatarsModule } from './modules/avatars/avatars.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['/app/appdata/.env', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [__dirname + '/database/entities/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: true,
        retryAttempts: 3,
        retryDelay: 3000,
        // Keep the connection pool alive so MySQL's wait_timeout doesn't
        // silently close idle connections between requests.
        extra: {
          connectionLimit: 10,
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000,
        },
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    CitiesModule,
    InvitesModule,
    AuthModule,
    UsersModule,
    AuditModule,
    NotificationsModule,
    FacebookGroupsModule,
    LocationsModule,
    EventsModule,
    AdminModule,
    StatsModule,
    EmailModule,
    FeedbackModule,
    ReleasesModule,
    IntegrationsModule,
    MuseModule,
    FacebookModule,
    AnnouncementsModule,
    EventCommentsModule,
    TasksModule,
    ReportsModule,
    CalendarModule,
    CommunityModule,
    MerchModule,
    AppConfigModule,
    AvatarsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerAuditGuard },
  ],
})
export class AppModule {}
