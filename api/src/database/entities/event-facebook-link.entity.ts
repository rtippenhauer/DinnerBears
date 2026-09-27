import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventEntity } from './event.entity';

// A Facebook event that mirrors a DinnerBears event (Phase 39). One dinner can
// have several — e.g. a Dayton dinner is posted in both the Cincinnati group
// and Gem City Bears — each with its own Going list, synced by Muse.
@Entity('event_facebook_links')
export class EventFacebookLinkEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'event_id', unsigned: true })
  eventId: number;

  @ManyToOne(() => EventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: EventEntity;

  // The digits from facebook.com/events/<id>. A Facebook event mirrors at
  // most one DinnerBears event.
  @Column({ name: 'facebook_event_id', type: 'varchar', length: 32, unique: true })
  facebookEventId: string;

  // The Facebook group the event was posted in, e.g. "Gem City Bears".
  @Column({ name: 'facebook_group', type: 'varchar', length: 200, nullable: true })
  facebookGroup: string | null;

  // When Muse read the Going list that was last applied — a sync carrying an
  // older extraction is refused so it can't undo a newer one.
  @Column({ name: 'last_extracted_at', type: 'datetime', nullable: true })
  lastExtractedAt: Date | null;

  @Column({ name: 'last_synced_at', type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;

  // How many people the last sync accepted from this Facebook event's list.
  @Column({ name: 'last_going_count', type: 'int', unsigned: true, nullable: true })
  lastGoingCount: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
