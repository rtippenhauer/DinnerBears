import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiTokenEntity } from '../../database/entities/api-token.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsService } from './integrations.service';
import { IntegrationsAdminController } from './integrations-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiTokenEntity, CityEntity, UserEntity]),
    AuditModule,
  ],
  providers: [IntegrationsService],
  controllers: [IntegrationsAdminController],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
