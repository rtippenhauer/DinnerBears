import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

export enum FacebookAccountStatus {
  // Seen on a Facebook Going list, not yet tied to a member.
  UNMATCHED = 'unmatched',
  // An admin linked it to a member — it counts through that member's RSVP.
  LINKED = 'linked',
  // An admin confirmed this person isn't a member (a guest, a spouse…). Still
  // counted as a Facebook-only attendee; just no longer in the review queue.
  NOT_MEMBER = 'not_member',
}

// A Facebook profile seen on a synced Going list (Phase 39). Keyed by the
// numeric Facebook profile ID; the vanity URL is kept current on each sync.
// One member can have several (someone with two Facebook accounts).
@Entity('facebook_accounts')
export class FacebookAccountEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  // Current vanity, normalized: lowercase "facebook.com/<vanity>".
  @Column({ name: 'profile_url', type: 'varchar', length: 255, nullable: true, unique: true })
  profileUrl: string | null;

  @Column({ name: 'facebook_user_id', type: 'varchar', length: 32, nullable: true, unique: true })
  facebookUserId: string | null;

  // Name as last seen on Facebook.
  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ type: 'enum', enum: FacebookAccountStatus, default: FacebookAccountStatus.UNMATCHED })
  status: FacebookAccountStatus;

  @Column({ name: 'user_id', type: 'int', unsigned: true, nullable: true })
  userId: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @Column({ name: 'linked_at', type: 'datetime', nullable: true })
  linkedAt: Date | null;

  @Column({ name: 'linked_by', type: 'int', unsigned: true, nullable: true })
  linkedById: number | null;

  @Column({ name: 'last_seen_at', type: 'datetime', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
