import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ApiTokenEntity } from '../../database/entities/api-token.entity';
import { AppConfigEntity } from '../../database/entities/app-config.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { EmailStatus, UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { apiTokenExpiry, generateApiToken, hashApiToken } from './api-token.util';

// Server-only app_config row (deliberately not a SITE_SETTING_KEY, so it isn't
// publicly readable or part of the settings form): the member whose Going RSVP
// holds unmatched Facebook attendees as +1 guest names.
export const FACEBOOK_SYNC_HOST_KEY = 'facebook_sync_host_user_id';

export interface IssuedToken {
  token: string;
  tokenPrefix: string;
  expiresAt: Date;
}

export interface IntegrationSummary {
  userId: number;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  activeToken: {
    id: number;
    tokenPrefix: string;
    createdAt: Date;
    expiresAt: Date;
    lastUsedAt: Date | null;
  } | null;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(ApiTokenEntity)
    private readonly tokenRepo: Repository<ApiTokenEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(AppConfigEntity)
    private readonly configRepo: Repository<AppConfigEntity>,
    private readonly auditService: AuditService,
  ) {}

  // Every automation account (Claude's included), with its live token if any.
  // Tokens only authenticate while the account holds the MUSE role.
  async list(): Promise<IntegrationSummary[]> {
    const users = await this.userRepo.find({
      where: { isAutomationAccount: true, status: Not(UserStatus.DELETED) },
      order: { createdAt: 'ASC' },
    });
    const now = new Date();
    const summaries: IntegrationSummary[] = [];
    for (const u of users) {
      const token = await this.tokenRepo.findOne({
        where: { userId: u.id, revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      const live = token && token.expiresAt > now ? token : null;
      summaries.push({
        userId: u.id,
        name: u.fullName,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        activeToken: live
          ? {
              id: live.id,
              tokenPrefix: live.tokenPrefix,
              createdAt: live.createdAt,
              expiresAt: live.expiresAt,
              lastUsedAt: live.lastUsedAt,
            }
          : null,
      });
    }
    return summaries;
  }

  async create(
    name: string,
    role: UserRole.AUTOMATION | UserRole.MUSE,
    actorId: number,
  ): Promise<IntegrationSummary & { issued: IssuedToken | null }> {
    const fullName = `${name.trim()}-automation`;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const email = `${slug}-automation@integration.invalid`;

    const clash = await this.userRepo.findOne({ where: [{ email }, { fullName, isAutomationAccount: true }] });
    if (clash) throw new ConflictException('An automation account with that name already exists');

    const [city] = await this.cityRepo.find({ order: { id: 'ASC' }, take: 1 });
    if (!city) throw new BadRequestException('Create a city before adding integrations');

    // `.invalid` is a reserved TLD, and EmailService refuses to send to it —
    // this account must never receive mail even if it lands on a mailing list.
    const user = await this.userRepo.save(
      this.userRepo.create({
        fullName,
        email,
        emailStatus: EmailStatus.ACTIVE,
        passwordHash: null,
        cityId: city.id,
        role,
        isAutomationAccount: true,
        status: UserStatus.ACTIVE,
      }),
    );

    await this.auditService.log({
      userId: actorId,
      action: 'integration.create',
      entityType: 'user',
      entityId: user.id,
      metadata: { name: fullName, role },
    });

    // Only a Muse account can use a token. The first one on an instance also
    // defaults the unmatched-guest host to whoever set it up, which is exactly
    // the "my +1s" arrangement.
    let issued: IssuedToken | null = null;
    if (role === UserRole.MUSE) {
      if (!(await this.getSyncHostId())) await this.setSyncHost(actorId, actorId);
      issued = await this.issueToken(user.id, actorId);
    }
    const summary = (await this.list()).find((s) => s.userId === user.id)!;
    return { ...summary, issued };
  }

  // Admin-initiated: revokes whatever is live and issues a fresh token.
  async regenerate(userId: number, actorId: number): Promise<IssuedToken> {
    await this.getIntegrationUser(userId);
    return this.issueToken(userId, actorId);
  }

  async revoke(userId: number, actorId: number): Promise<void> {
    await this.getIntegrationUser(userId);
    const revoked = await this.revokeLiveTokens(userId);
    await this.auditService.log({
      userId: actorId,
      action: 'integration.token_revoke',
      entityType: 'user',
      entityId: userId,
      metadata: { revokedTokenIds: revoked },
    });
  }

  // Integration-initiated: swaps the calling token for a new one. The old one
  // stops working immediately, so the caller must persist the new value before
  // doing anything else.
  async rotate(user: UserEntity, currentTokenId: number | undefined): Promise<IssuedToken> {
    if (!currentTokenId) throw new UnauthorizedException('Token rotation requires an API token');
    const current = await this.tokenRepo.findOne({ where: { id: currentTokenId, userId: user.id } });
    if (!current || current.revokedAt) throw new UnauthorizedException('Invalid API token');
    return this.issueToken(user.id, null);
  }

  async describeSelf(
    user: UserEntity,
    currentTokenId: number | undefined,
  ): Promise<{ userId: number; name: string; tokenExpiresAt: Date | null }> {
    const token = currentTokenId ? await this.tokenRepo.findOne({ where: { id: currentTokenId } }) : null;
    return { userId: user.id, name: user.fullName, tokenExpiresAt: token?.expiresAt ?? null };
  }

  async getSyncHostId(): Promise<number | null> {
    const row = await this.configRepo.findOne({ where: { configKey: FACEBOOK_SYNC_HOST_KEY } });
    const id = row ? parseInt(row.configValue, 10) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  async getSyncHost(): Promise<{ id: number; fullName: string } | null> {
    const id = await this.getSyncHostId();
    if (!id) return null;
    const user = await this.userRepo.findOne({ where: { id } });
    return user ? { id: user.id, fullName: user.fullName } : null;
  }

  async setSyncHost(userId: number, actorId: number): Promise<{ id: number; fullName: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new NotFoundException('Member not found');
    if (user.isAutomationAccount) {
      throw new BadRequestException('The sync host must be a real member');
    }

    let row = await this.configRepo.findOne({ where: { configKey: FACEBOOK_SYNC_HOST_KEY } });
    if (!row) row = this.configRepo.create({ configKey: FACEBOOK_SYNC_HOST_KEY, configValue: '' });
    row.configValue = String(user.id);
    row.updatedBy = actorId;
    await this.configRepo.save(row);

    await this.auditService.log({
      userId: actorId,
      action: 'integration.sync_host_set',
      entityType: 'user',
      entityId: user.id,
    });
    return { id: user.id, fullName: user.fullName };
  }

  private async getIntegrationUser(userId: number): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id: userId, isAutomationAccount: true } });
    if (!user) throw new NotFoundException('Automation account not found');
    return user;
  }

  private async revokeLiveTokens(userId: number): Promise<number[]> {
    const live = await this.tokenRepo.find({ where: { userId, revokedAt: IsNull() } });
    if (live.length === 0) return [];
    const now = new Date();
    for (const t of live) t.revokedAt = now;
    await this.tokenRepo.save(live);
    return live.map((t) => t.id);
  }

  private async issueToken(userId: number, actorId: number | null): Promise<IssuedToken> {
    const revoked = await this.revokeLiveTokens(userId);
    const token = generateApiToken();
    const saved = await this.tokenRepo.save(
      this.tokenRepo.create({
        userId,
        tokenHash: hashApiToken(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt: apiTokenExpiry(),
        createdById: actorId,
      }),
    );
    await this.auditService.log({
      userId: actorId ?? userId,
      action: actorId ? 'integration.token_issue' : 'integration.token_rotate',
      entityType: 'user',
      entityId: userId,
      metadata: { tokenId: saved.id, revokedTokenIds: revoked, expiresAt: saved.expiresAt.toISOString() },
    });
    return { token, tokenPrefix: saved.tokenPrefix, expiresAt: saved.expiresAt };
  }
}
