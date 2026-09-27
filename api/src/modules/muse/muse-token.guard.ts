import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { ApiTokenEntity } from '../../database/entities/api-token.entity';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { API_TOKEN_PREFIX, hashApiToken } from '../integrations/api-token.util';

export type MuseRequest = Request & { user?: UserEntity; apiTokenId?: number };

// Phase 39: authenticates the /muse routes from an `Authorization: Bearer
// cet_…` token and nothing else — a session cookie is ignored here, and a
// token is ignored everywhere else. The token must be live and belong to an
// active account currently holding the MUSE role.
@Injectable()
export class MuseTokenGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiTokenEntity)
    private readonly tokenRepo: Repository<ApiTokenEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MuseRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token.startsWith(API_TOKEN_PREFIX)) throw new UnauthorizedException('Missing API token');

    const row = await this.tokenRepo.findOne({ where: { tokenHash: hashApiToken(token) } });
    if (!row || row.revokedAt) throw new UnauthorizedException('Invalid API token');
    if (row.expiresAt <= new Date()) throw new UnauthorizedException('API token expired');

    const user = await this.userRepo.findOne({ where: { id: row.userId } });
    if (!user || user.role !== UserRole.MUSE || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Muse account not active');
    }

    await this.tokenRepo.update(row.id, { lastUsedAt: new Date() });
    req.user = user;
    req.apiTokenId = row.id;
    return true;
  }
}
