import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';
import { FacebookAccountEntity } from './facebook-account.entity';

// A Facebook account's Going status for one DinnerBears event (Phase 39),
// merged across every Facebook event linked to it. `sources` maps each
// Facebook event ID whose Going list currently includes this person to the
// +1s read there, so each list is tracked independently: a sync replaces only
// its own entry, and the person stops counting once no list has them.
//
// While the account isn't linked to a member, this row *is* the attendee — a
// Facebook-only person in the headcount, attendance and the event page. Once
// linked, the member's own RSVP stands in for it instead.
@Entity('facebook_event_attendees')
@Unique('UQ_fb_attendee_event_account', ['eventId', 'facebookAccountId'])
export class FacebookEventAttendeeEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  @Column({ name: 'facebook_account_id', unsigned: true })
  facebookAccountId: number;

  @ManyToOne(() => FacebookAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'facebook_account_id' })
  facebookAccount: FacebookAccountEntity;

  @Column({ type: 'json' })
  sources: Record<string, number>;

  // Marked from the attendance dialog. Carried over to the member (as an
  // attended RSVP, with points) if the account is later linked.
  @Column({ type: 'tinyint', nullable: true, default: null })
  attended: boolean | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// Going on at least one linked Facebook event right now.
export function isFacebookGoing(row: Pick<FacebookEventAttendeeEntity, 'sources'>): boolean {
  return Object.keys(row.sources ?? {}).length > 0;
}

// +1s for the dinner: the most any one list shows (the same person in two
// groups shouldn't double their guests).
export function facebookPlusOnes(row: Pick<FacebookEventAttendeeEntity, 'sources'>): number {
  return Math.max(0, ...Object.values(row.sources ?? {}).map((n) => Number(n) || 0));
}
