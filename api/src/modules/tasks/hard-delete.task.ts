import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { FacebookDeletionRequestEntity, FacebookDeletionStatus } from '../../database/entities/facebook-deletion-request.entity';
import { FacebookAccountEntity, FacebookAccountStatus } from '../../database/entities/facebook-account.entity';
import { AuditService } from '../audit/audit.service';

const LOCAL_PHOTO_PREFIX = '/api/v1/uploads/profiles/';

@Injectable()
export class HardDeleteTask {
  private readonly logger = new Logger(HardDeleteTask.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FacebookDeletionRequestEntity)
    private readonly fbDeletionRepo: Repository<FacebookDeletionRequestEntity>,
    @InjectRepository(FacebookAccountEntity)
    private readonly facebookAccountRepo: Repository<FacebookAccountEntity>,
    private readonly auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runHardDelete(): Promise<void> {
    const now = new Date();
    const due = await this.userRepo.find({
      where: {
        status: UserStatus.DELETED,
        hardDeleteAt: LessThanOrEqual(now),
      },
    });

    if (due.length === 0) return;
    this.logger.log(`Hard-delete cron: processing ${due.length} account(s)`);

    for (const user of due) {
      try {
        await this.processUser(user);
      } catch (err) {
        this.logger.error(`Hard-delete failed for user ${user.id}: ${(err as Error).message}`);
      }
    }
  }

  private async processUser(user: UserEntity): Promise<void> {
    // Delete local photo from disk before nulling the path
    if (user.profilePhotoPath?.startsWith(LOCAL_PHOTO_PREFIX)) {
      const filename = user.profilePhotoPath.replace(LOCAL_PHOTO_PREFIX, '');
      const uploadPath = process.env.UPLOAD_PATH ?? '/app/uploads';
      try {
        await unlink(join(uploadPath, 'profiles', filename));
      } catch {
        // File may already be gone — not fatal
      }
    }

    // Overwrite PII — users row stays as tombstone for FK integrity
    await this.userRepo.update(user.id, {
      fullName: 'Deleted Member',
      email: `deleted-${user.id}@deleted.dinnerbears.com`,
      passwordHash: null,
      profilePhotoPath: null,
      emailVerifiedAt: null,
      hardDeleteAt: null,
    });

    // Phase 39: the member asked to be removed, so drop the tie between their
    // account and any Facebook profile the sync saw. (Bans and admin deletes
    // never reach here — those keep the link, so a banned person is still
    // recognized on a Facebook Going list.)
    await this.facebookAccountRepo.update(
      { userId: user.id },
      { userId: null, status: FacebookAccountStatus.UNMATCHED, linkedAt: null, linkedById: null },
    );

    // Mark any pending facebook deletion requests as completed
    await this.fbDeletionRepo.update(
      { dinnerbearsUserId: user.id, status: FacebookDeletionStatus.PENDING },
      { status: FacebookDeletionStatus.COMPLETED, completedAt: new Date() },
    );

    await this.auditService.log({
      action: 'account_hard_deleted',
      entityType: 'user',
      entityId: user.id,
    });

    this.logger.log(`Hard-deleted user ${user.id}`);
  }
}
