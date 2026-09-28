import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 39: a linked member's Facebook +1s live beside their website guests
// rather than being merged into them — see EventRsvpEntity.facebookGuestNames.
export class AddFacebookGuestsToRsvps1785000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_rsvps
        ADD COLUMN facebook_guest_names JSON NULL AFTER source,
        ADD COLUMN facebook_guest_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER facebook_guest_names
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN facebook_guest_count, DROP COLUMN facebook_guest_names`);
  }
}
