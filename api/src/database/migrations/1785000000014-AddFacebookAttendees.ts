import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 39 (revised): Facebook events linked to DinnerBears events, the
// Facebook accounts seen on their Going lists, and each account's merged
// Going status per event. Replaces the "unmatched attendees go on the sync
// host's +1s" design, so its config row is dropped.
export class AddFacebookAttendees1785000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_facebook_links (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id INT UNSIGNED NOT NULL,
        facebook_event_id VARCHAR(32) NOT NULL,
        facebook_group VARCHAR(200) NULL,
        last_extracted_at DATETIME NULL,
        last_synced_at DATETIME NULL,
        last_going_count INT UNSIGNED NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_event_facebook_links_fb_event (facebook_event_id),
        KEY IDX_event_facebook_links_event (event_id),
        CONSTRAINT FK_event_facebook_links_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE facebook_accounts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        profile_url VARCHAR(255) NULL,
        facebook_user_id VARCHAR(32) NULL,
        display_name VARCHAR(200) NOT NULL,
        status ENUM('unmatched','linked','not_member') NOT NULL DEFAULT 'unmatched',
        user_id INT UNSIGNED NULL,
        linked_at DATETIME NULL,
        linked_by INT UNSIGNED NULL,
        last_seen_at DATETIME NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_facebook_accounts_profile_url (profile_url),
        UNIQUE KEY UQ_facebook_accounts_fb_user_id (facebook_user_id),
        KEY IDX_facebook_accounts_user (user_id),
        CONSTRAINT FK_facebook_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE facebook_event_attendees (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        event_id INT UNSIGNED NOT NULL,
        facebook_account_id INT UNSIGNED NOT NULL,
        sources JSON NOT NULL,
        attended TINYINT NULL DEFAULT NULL,
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_fb_attendee_event_account (event_id, facebook_account_id),
        KEY IDX_fb_attendee_account (facebook_account_id),
        CONSTRAINT FK_fb_attendee_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT FK_fb_attendee_account FOREIGN KEY (facebook_account_id) REFERENCES facebook_accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`DELETE FROM app_config WHERE config_key = 'facebook_sync_host_user_id'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE facebook_event_attendees`);
    await queryRunner.query(`DROP TABLE facebook_accounts`);
    await queryRunner.query(`DROP TABLE event_facebook_links`);
  }
}
