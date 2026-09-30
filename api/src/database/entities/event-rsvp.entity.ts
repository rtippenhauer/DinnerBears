import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';
import { EventGuestLinkEntity } from './event-guest-link.entity';
import { UserEntity } from './user.entity';

// Who put this RSVP in place (Phase 39). The Facebook sync may only ever
// remove RSVPs it created itself; the moment a member touches their own RSVP
// it becomes MEMBER-owned and the sync leaves it alone for good.
export enum RsvpSource {
  MEMBER = 'member',
  ADMIN = 'admin',
  FACEBOOK_SYNC = 'facebook_sync',
}

export enum RsvpStatus {
  GOING = 'going',
  MAYBE = 'maybe',
  NOT_GOING = 'not_going',
}

@Entity('event_rsvps')
export class EventRsvpEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, (e) => e.rsvps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'enum', enum: RsvpStatus, default: RsvpStatus.GOING })
  status: RsvpStatus;

  @Column({ name: 'additional_guests', type: 'tinyint', unsigned: true, default: 0 })
  additionalGuests: number;

  @Column({ name: 'guest_names', type: 'json', nullable: true })
  guestNames: string[] | null;

  // Phase 35: optional free-text note on what this member is bringing, shown
  // in the attendee list for Residence-location events. Not location-gated
  // server-side — same trust model as guestNames.
  @Column({ name: 'bringing_item', type: 'varchar', length: 200, nullable: true })
  bringingItem: string | null;

  @Column({ type: 'enum', enum: RsvpSource, default: RsvpSource.MEMBER })
  source: RsvpSource;

  // A linked member's +1s from the Facebook comments (Phase 39) — kept apart
  // from the guests they added on the website, which the sync never touches.
  // Replaced on every sync. Names (unnamed +1s as null) exclude anyone already
  // among the member's named website guests; the count is what the headcount
  // adds on top of `additionalGuests`.
  @Column({ name: 'facebook_guest_names', type: 'json', nullable: true })
  facebookGuestNames: (string | null)[] | null;

  @Column({ name: 'facebook_guest_count', type: 'tinyint', unsigned: true, default: 0 })
  facebookGuestCount: number;

  @Column({ type: 'tinyint', nullable: true, default: null })
  attended: boolean | null;

  @Column({ name: 'is_walkin', type: 'tinyint', default: false })
  isWalkin: boolean;

  @Column({ name: 'from_other_city', type: 'tinyint', default: false })
  fromOtherCity: boolean;

  @OneToMany(() => EventGuestLinkEntity, (l) => l.memberRsvp)
  guestLinks: EventGuestLinkEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
