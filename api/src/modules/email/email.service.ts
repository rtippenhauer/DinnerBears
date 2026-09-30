import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailQueueEntity, EmailQueueStatus } from '../../database/entities/email-queue.entity';
import { EmailSuppressionEntity, SuppressionReason } from '../../database/entities/email-suppression.entity';
import { NotificationPreferencesEntity } from '../../database/entities/notification-preferences.entity';
import { UserEntity, EmailStatus } from '../../database/entities/user.entity';
import { EmailTemplateName, NOTIFICATION_PREF_KEY } from './email.constants';
import { BrevoService, EmailAttachment } from './brevo.service';

const NOTIFICATION_PREF_FIELDS = [
  'emailInvite',
  'emailVerification',
  'emailPasswordReset',
  'emailPasswordChanged',
  'emailSecurityAlert',
  'emailEventPublished',
  'emailRsvpConfirmation',
  'emailEventReminder',
  'emailAccountDeletion',
  'emailReengagement',
  'pushEventPublished',
  'pushEventReminder',
  'pushAnnouncement',
] as const satisfies readonly (keyof NotificationPreferencesEntity)[];

export interface QueueEmailDto {
  toEmail: string;
  toName?: string | null;
  subject: string;
  templateId?: EmailTemplateName;
  templateParams?: Record<string, unknown>;
  htmlBody?: string | null;
  textBody?: string | null;
  priority?: number;
  sendAfter?: Date;
  bypassSuppression?: boolean;
  userId?: number;
  attachments?: EmailAttachment[];
}

// Placeholder addresses on the automation/integration accounts (reserved
// TLDs, see Phase 39). Never hand them to a provider — they'd only bounce and
// count against sender reputation.
function isUndeliverableAddress(email: string | null | undefined): boolean {
  return !!email && /\.(invalid|internal)$/i.test(email.trim());
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly suppressionSalt: string;

  constructor(
    @InjectRepository(EmailQueueEntity)
    private readonly queueRepo: Repository<EmailQueueEntity>,
    @InjectRepository(EmailSuppressionEntity)
    private readonly suppressionRepo: Repository<EmailSuppressionEntity>,
    @InjectRepository(NotificationPreferencesEntity)
    private readonly prefsRepo: Repository<NotificationPreferencesEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly config: ConfigService,
    private readonly brevo: BrevoService,
  ) {
    this.suppressionSalt = this.config.get<string>('EMAIL_SUPPRESSION_SALT', 'default-salt');
  }

  private hashEmail(email: string): string {
    return createHash('sha256')
      .update(this.suppressionSalt + email.toLowerCase())
      .digest('hex');
  }

  async isSuppressed(email: string): Promise<boolean> {
    const hash = this.hashEmail(email);
    const record = await this.suppressionRepo.findOne({ where: { emailHash: hash } });
    return record !== null;
  }

  async suppress(email: string, reason: SuppressionReason): Promise<void> {
    const hash = this.hashEmail(email);
    const existing = await this.suppressionRepo.findOne({ where: { emailHash: hash } });
    if (!existing) {
      await this.suppressionRepo.save(this.suppressionRepo.create({ emailHash: hash, reason }));
    }
  }

  async removeSuppression(email: string): Promise<void> {
    const hash = this.hashEmail(email);
    await this.suppressionRepo.delete({ emailHash: hash });
  }

  private async checkNotificationPref(userId: number, template: EmailTemplateName): Promise<boolean> {
    const prefKey = NOTIFICATION_PREF_KEY[template];
    if (!prefKey) return true;

    const prefs = await this.prefsRepo.findOne({ where: { userId } });
    if (!prefs) return true;

    // These columns are generic `tinyint`, not TypeORM's special `boolean` type,
    // so the driver returns 0/1 rather than false/true — comparing against the
    // literal `false` here always passed, silently defeating every opt-out.
    const value = (prefs as unknown as Record<string, boolean | number>)[prefKey];
    return Number(value) !== 0;
  }

  async queue(dto: QueueEmailDto): Promise<EmailQueueEntity | null> {
    if (isUndeliverableAddress(dto.toEmail)) {
      this.logger.debug(`Email to ${dto.toEmail} skipped — non-routable internal address`);
      return null;
    }
    if (!dto.bypassSuppression) {
      const suppressed = await this.isSuppressed(dto.toEmail);
      if (suppressed) {
        this.logger.warn(`Email to ${dto.toEmail} suppressed — skipping`);
        return null;
      }
    }

    if (dto.userId && dto.templateId) {
      const user = await this.userRepo.findOne({ where: { id: dto.userId } });
      if (user) {
        if (
          user.emailStatus === EmailStatus.BOUNCED ||
          user.emailStatus === EmailStatus.COMPLAINED
        ) {
          this.logger.debug(`Email to ${dto.toEmail} blocked — status: ${user.emailStatus}`);
          return null;
        }
        const allowed = await this.checkNotificationPref(dto.userId, dto.templateId);
        if (!allowed) {
          this.logger.debug(`Email to ${dto.toEmail} skipped — preference disabled for ${dto.templateId}`);
          return null;
        }
      }
    }

    const entry = this.queueRepo.create({
      toEmail: dto.toEmail,
      toName: dto.toName ?? null,
      subject: dto.subject,
      templateId: dto.templateId ?? null,
      templateParams: dto.templateParams ?? null,
      htmlBody: dto.htmlBody ?? null,
      textBody: dto.textBody ?? null,
      priority: dto.priority ?? 5,
      sendAfter: dto.sendAfter ?? null,
      status: EmailQueueStatus.PENDING,
    });

    return this.queueRepo.save(entry);
  }

  async sendNow(dto: QueueEmailDto): Promise<void> {
    if (isUndeliverableAddress(dto.toEmail)) return;
    try {
      await this.brevo.send({
        toEmail: dto.toEmail,
        toName: dto.toName,
        subject: dto.subject,
        htmlBody: dto.htmlBody,
        textBody: dto.textBody,
        attachments: dto.attachments,
      });
    } catch (err) {
      this.logger.warn(`Immediate send failed for ${dto.toEmail}, falling back to queue: ${(err as Error).message}`);
      await this.queue({ ...dto, bypassSuppression: true });
    }
  }

  async getQueue(limit = 100): Promise<EmailQueueEntity[]> {
    return this.queueRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async cancelEmail(id: number): Promise<void> {
    await this.queueRepo.update(id, { status: EmailQueueStatus.CANCELLED });
  }

  async retryFailed(): Promise<number> {
    const result = await this.queueRepo
      .createQueryBuilder()
      .update(EmailQueueEntity)
      .set({ status: EmailQueueStatus.PENDING, attempts: 0, errorMessage: null })
      .where('status = :status', { status: EmailQueueStatus.FAILED })
      .execute();
    return result.affected ?? 0;
  }

  async getNotificationPrefs(userId: number): Promise<NotificationPreferencesEntity> {
    let prefs = await this.prefsRepo.findOne({ where: { userId } });
    if (!prefs) {
      prefs = this.prefsRepo.create({ userId });
      prefs = await this.prefsRepo.save(prefs);
    }
    return prefs;
  }

  async updateNotificationPrefs(
    userId: number,
    updates: Partial<Pick<NotificationPreferencesEntity, (typeof NOTIFICATION_PREF_FIELDS)[number]>>,
  ): Promise<NotificationPreferencesEntity> {
    let prefs = await this.prefsRepo.findOne({ where: { userId } });
    if (!prefs) {
      prefs = this.prefsRepo.create({ userId });
    }
    for (const key of NOTIFICATION_PREF_FIELDS) {
      if (updates[key] !== undefined) {
        prefs[key] = updates[key];
      }
    }
    return this.prefsRepo.save(prefs);
  }
}
