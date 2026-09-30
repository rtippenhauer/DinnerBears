import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  EmailQueueEntity,
  EmailQueueStatus,
  EmailProvider,
} from '../../database/entities/email-queue.entity';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailTemplateName } from './email.constants';

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;

@Injectable()
export class EmailDispatcherService {
  private readonly logger = new Logger(EmailDispatcherService.name);

  constructor(
    @InjectRepository(EmailQueueEntity)
    private readonly queueRepo: Repository<EmailQueueEntity>,
    @InjectRepository(EmailProviderConfigEntity)
    private readonly configRepo: Repository<EmailProviderConfigEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly brevo: BrevoService,
    private readonly resend: ResendService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchPending(): Promise<void> {
    const providerConfig = await this.getOrCreateConfig();
    this.resetDailyCountersIfNeeded(providerConfig);

    const now = new Date();
    const batch = await this.queueRepo.find({
      where: [
        { status: EmailQueueStatus.PENDING, sendAfter: IsNull() },
        { status: EmailQueueStatus.PENDING, sendAfter: LessThanOrEqual(now) },
      ],
      order: { priority: 'ASC', createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    for (const email of batch) {
      await this.sendOne(email, providerConfig);
    }

    await this.configRepo.save(providerConfig);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async inactivityCheck(): Promise<void> {
    const now = new Date();

    const days = (n: number) => new Date(now.getTime() - n * 86400000);

    const users60 = await this.userRepo
      .createQueryBuilder('u')
      .where('u.status = :active', { active: 'active' })
      // Automation accounts (Claude, Muse — Phase 39) never log in like a person;
      // sweeping them would break the integration and orphan their audit rows.
      .andWhere('u.is_automation_account = 0')
      .andWhere('u.last_login_at < :cutoff', { cutoff: days(60) })
      .andWhere('u.last_login_at >= :cutoff2', { cutoff2: days(61) })
      .getMany();

    for (const u of users60) {
      this.logger.log(`60-day inactivity: queuing re-engagement for ${u.email}`);
    }

    const users90 = await this.userRepo
      .createQueryBuilder('u')
      .where('u.status = :active', { active: 'active' })
      // Automation accounts (Claude, Muse — Phase 39) never log in like a person;
      // sweeping them would break the integration and orphan their audit rows.
      .andWhere('u.is_automation_account = 0')
      .andWhere('u.last_login_at < :cutoff', { cutoff: days(90) })
      .andWhere('u.last_login_at >= :cutoff2', { cutoff2: days(91) })
      .getMany();

    for (const u of users90) {
      this.logger.log(`90-day inactivity: queuing final warning for ${u.email}`);
    }

    const users120 = await this.userRepo
      .createQueryBuilder('u')
      .where('u.status = :active', { active: 'active' })
      // Automation accounts (Claude, Muse — Phase 39) never log in like a person;
      // sweeping them would break the integration and orphan their audit rows.
      .andWhere('u.is_automation_account = 0')
      .andWhere('u.last_login_at < :cutoff', { cutoff: days(120) })
      .getMany();

    for (const u of users120) {
      this.logger.log(`120-day inactivity: soft deleting ${u.email}`);
      u.status = 'deleted' as never;
      u.deletedAt = now;
      u.hardDeleteAt = new Date(now.getTime() + 30 * 86400000);
      await this.userRepo.save(u);
    }

    const users150 = await this.userRepo
      .createQueryBuilder('u')
      .where('u.hard_delete_at <= :now', { now })
      .andWhere('u.deleted_at IS NOT NULL')
      .getMany();

    for (const u of users150) {
      this.logger.log(`Hard deleting ${u.email}`);
      await this.userRepo.remove(u);
    }
  }

  private async sendOne(
    email: EmailQueueEntity,
    providerConfig: EmailProviderConfigEntity,
  ): Promise<void> {
    email.attempts += 1;
    email.lastAttemptAt = new Date();

    const useBrevo =
      providerConfig.brevoEnabled &&
      (await this.brevo.isConfigured()) &&
      providerConfig.brevoSentToday < providerConfig.brevoDailyLimit;

    const useResend =
      !useBrevo &&
      providerConfig.resendOverflowEnabled &&
      (await this.resend.isConfigured()) &&
      providerConfig.resendSentToday < providerConfig.resendDailyLimit;

    if (!useBrevo && !useResend) {
      email.status = EmailQueueStatus.BLOCKED;
      email.errorMessage = 'No provider available or daily limit reached';
      await this.queueRepo.save(email);
      return;
    }

    try {
      if (useBrevo) {
        await this.brevo.send({
          toEmail: email.toEmail,
          toName: email.toName,
          subject: email.subject,
          templateName: email.templateId as EmailTemplateName | undefined,
          templateParams: email.templateParams ?? undefined,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
        });
        email.provider = EmailProvider.BREVO;
        providerConfig.brevoSentToday += 1;
      } else {
        await this.resend.send({
          toEmail: email.toEmail,
          toName: email.toName,
          subject: email.subject,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
        });
        email.provider = EmailProvider.GMAIL;
        providerConfig.resendSentToday += 1;
      }

      email.status = EmailQueueStatus.SENT;
      email.sentAt = new Date();
    } catch (err) {
      this.logger.error(`Failed to send email ${email.id}: ${(err as Error).message}`);
      email.errorMessage = (err as Error).message;
      email.status =
        email.attempts >= MAX_ATTEMPTS ? EmailQueueStatus.FAILED : EmailQueueStatus.PENDING;
    }

    await this.queueRepo.save(email);
  }

  private async getOrCreateConfig(): Promise<EmailProviderConfigEntity> {
    let config = await this.configRepo.findOne({ where: { id: 1 } });
    if (!config) {
      config = this.configRepo.create({
        brevoEnabled: true,
        resendOverflowEnabled: false,
        brevoDailyLimit: 300,
        resendDailyLimit: 1000,
        brevoSentToday: 0,
        resendSentToday: 0,
        lastResetDate: new Date().toISOString().split('T')[0],
      });
      await this.configRepo.save(config);
    }
    return config;
  }

  private resetDailyCountersIfNeeded(config: EmailProviderConfigEntity): void {
    const today = new Date().toISOString().split('T')[0];
    if (config.lastResetDate !== today) {
      config.brevoSentToday = 0;
      config.resendSentToday = 0;
      config.lastResetDate = today;
    }
  }
}
