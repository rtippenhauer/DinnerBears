import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CityEntity } from './city.entity';

export enum UserRole {
  NON_VALIDATED = 'non_validated',
  MEMBER = 'member',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  // Dedicated account for Claude Code automation (release drafting, feedback
  // triage) — a real user row, never an impersonation of an admin. Rob can
  // temporarily reassign it to member/moderator/admin via the normal admin
  // users UI to let it browse role-gated pages for testing, then flip it
  // back. While actually in this role, it's excluded from leaderboards and
  // member lists (once reassigned to member/moderator/admin, it shows up
  // like any other account of that role would).
  AUTOMATION = 'automation',
  // Phase 39: the Muse Facebook-event sync. Authenticates only with an API
  // token, and only on the /muse routes (MuseTokenGuard) — never through the
  // normal session guards. Like AUTOMATION: hidden from leaderboards, the
  // member directory and member search, and only an automation account (see
  // isAutomationAccount) can hold it.
  MUSE = 'muse',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export enum EmailStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  UNSUBSCRIBED = 'unsubscribed',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
}

export enum InviteSource {
  DIRECT = 'direct',
  FACEBOOK_GROUP = 'facebook_group',
  GOOGLE_OAUTH = 'google_oauth',
  NON_VALIDATED_LINK = 'non_validated_link',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'full_name', length: 200 })
  fullName: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({
    name: 'email_status',
    type: 'enum',
    enum: EmailStatus,
    default: EmailStatus.PENDING,
  })
  emailStatus: EmailStatus;

  @Column({ name: 'email_verified_at', type: 'datetime', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ name: 'email_verification_token', type: 'varchar', length: 255, nullable: true })
  emailVerificationToken: string | null;

  @Column({ name: 'email_verification_expires_at', type: 'datetime', nullable: true })
  emailVerificationExpiresAt: Date | null;

  @Column({ name: 'password_reset_token', type: 'varchar', length: 255, nullable: true })
  passwordResetToken: string | null;

  @Column({ name: 'password_reset_expires_at', type: 'datetime', nullable: true })
  passwordResetExpiresAt: Date | null;

  @Column({ name: 'city_id', unsigned: true })
  cityId: number;

  @ManyToOne(() => CityEntity)
  @JoinColumn({ name: 'city_id' })
  city: CityEntity;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MEMBER })
  role: UserRole;

  // Phase 39: a non-person account (Claude's automation account, Muse's sync
  // account). Only these may hold the AUTOMATION or MUSE roles, and they can
  // be moved between those and up to admin for testing. Fixed at creation —
  // a role change never turns a member into one.
  @Column({ name: 'is_automation_account', type: 'tinyint', default: false })
  isAutomationAccount: boolean;

  // Phase 35 (membership fee): whether this member has paid dues, and when that
  // membership expires. Memberships always run calendar-year (expire Jan 1 of the
  // following year regardless of payment date — see AdminService.setMembership).
  // Enforcement (blocking a Going RSVP once the member's free first meeting is
  // used) lives in EventsService.upsertRsvp, gated by the feature_require_membership
  // toggle.
  @Column({ name: 'has_membership', type: 'tinyint', default: false })
  hasMembership: boolean;

  @Column({ name: 'membership_expires_at', type: 'datetime', nullable: true })
  membershipExpiresAt: Date | null;

  @Column({ name: 'profile_photo_path', type: 'varchar', length: 500, nullable: true })
  profilePhotoPath: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ name: 'invited_by', type: 'int', unsigned: true, nullable: true })
  invitedBy: number | null;

  @Column({ name: 'invite_id', type: 'int', unsigned: true, nullable: true })
  inviteId: number | null;

  @Column({
    name: 'invite_source',
    type: 'enum',
    enum: InviteSource,
    nullable: true,
  })
  inviteSource: InviteSource | null;

  @Column({ name: 'invite_source_name', type: 'varchar', length: 255, nullable: true })
  inviteSourceName: string | null;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'login_count', unsigned: true, default: 0 })
  loginCount: number;

  @Column({ name: 'qualifying_login_count', unsigned: true, default: 0 })
  qualifyingLoginCount: number;

  @Column({ name: 'last_qualifying_login_at', type: 'datetime', nullable: true })
  lastQualifyingLoginAt: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'tinyint', unsigned: true, default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'login_locked_until', type: 'datetime', nullable: true })
  loginLockedUntil: Date | null;

  @Column({ name: 'last_failed_login_at', type: 'datetime', nullable: true })
  lastFailedLoginAt: Date | null;

  @Column({ name: 'calendar_token', type: 'varchar', length: 36, nullable: true, unique: true })
  calendarToken: string | null;

  @Column({ name: 'calendar_city_filter', type: 'enum', enum: ['all', 'city'], default: 'all' })
  calendarCityFilter: 'all' | 'city';

  @Column({ name: 'calendar_rsvp_only', type: 'tinyint', default: 0 })
  calendarRsvpOnly: boolean;

  @Column({ name: 'calendar_auto_invite', type: 'enum', enum: ['none', 'city', 'all'], default: 'none' })
  calendarAutoInvite: 'none' | 'city' | 'all';

  @Column({ name: 'selected_title', type: 'varchar', length: 100, nullable: true })
  selectedTitle: string | null;

  @Column({ name: 'last_seen_release_id', type: 'int', unsigned: true, nullable: true })
  lastSeenReleaseId: number | null;

  @Column({ name: 'last_seen_announcement_id', type: 'int', unsigned: true, nullable: true })
  lastSeenAnnouncementId: number | null;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'hard_delete_at', type: 'datetime', nullable: true })
  hardDeleteAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
