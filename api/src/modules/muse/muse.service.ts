import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InviteEntity, InviteFlavor } from '../../database/entities/invite.entity';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { InvitesService } from '../invites/invites.service';

export interface MuseInviteLink {
  id: number;
  flavor: InviteFlavor | null;
  token: string;
  url: string;
  expiresAt: Date;
  isRevoked: boolean;
  createdAt: Date;
}

@Injectable()
export class MuseService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(InviteEntity)
    private readonly inviteRepo: Repository<InviteEntity>,
    private readonly invitesService: InvitesService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  // Real, active people — what Facebook names get matched against. Names and
  // ids only: Muse has no need for anyone's email or contact details.
  async listMembers(): Promise<{ id: number; fullName: string; cityId: number; role: UserRole }[]> {
    const users = await this.userRepo.find({
      where: { status: UserStatus.ACTIVE, isAutomationAccount: false },
      select: ['id', 'fullName', 'cityId', 'role'],
      order: { fullName: 'ASC' },
    });
    return users.map((u) => ({ id: u.id, fullName: u.fullName, cityId: u.cityId, role: u.role }));
  }

  // Same view as the event page's Share dialog: the active link for each
  // flavor is the newest one that isn't revoked. `member` = full membership,
  // `nonValidated` = requires validation.
  async getInviteLinks(eventId: number): Promise<{
    member: MuseInviteLink | null;
    nonValidated: MuseInviteLink | null;
    all: MuseInviteLink[];
  }> {
    const all = (await this.invitesService.findByEvent(eventId)).map((i) => this.toLink(i));
    return {
      member: all.find((l) => l.flavor === InviteFlavor.MEMBER && !l.isRevoked) ?? null,
      nonValidated: all.find((l) => l.flavor === InviteFlavor.NON_VALIDATED && !l.isRevoked) ?? null,
      all,
    };
  }

  async createInviteLink(eventId: number, flavor: InviteFlavor, museUser: UserEntity): Promise<MuseInviteLink> {
    const invite = await this.invitesService.createEventInvite(eventId, flavor, museUser);
    await this.auditService.log({
      userId: museUser.id,
      action: 'muse.invite_create',
      entityType: 'event',
      entityId: eventId,
      metadata: { inviteId: invite.id, flavor },
    });
    return this.toLink(invite);
  }

  async revokeInviteLink(eventId: number, inviteId: number, museUser: UserEntity): Promise<{ success: true }> {
    const invite = await this.inviteRepo.findOne({ where: { id: inviteId, eventId } });
    if (!invite) throw new NotFoundException('Invite link not found for this event');
    await this.invitesService.revoke(inviteId);
    await this.auditService.log({
      userId: museUser.id,
      action: 'muse.invite_revoke',
      entityType: 'event',
      entityId: eventId,
      metadata: { inviteId },
    });
    return { success: true };
  }

  private toLink(i: InviteEntity): MuseInviteLink {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com').replace(/\/$/, '');
    return {
      id: i.id,
      flavor: i.inviteFlavor,
      token: i.token,
      url: `${appUrl}/join/${i.token}`,
      expiresAt: i.expiresAt,
      isRevoked: !!i.isRevoked,
      createdAt: i.createdAt,
    };
  }
}
