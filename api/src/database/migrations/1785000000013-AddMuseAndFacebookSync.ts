import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 39: automation accounts + the Muse Facebook-event sync.
//  - users.role gains 'muse'; users.is_automation_account marks non-person
//    accounts (the existing Claude automation account is backfilled) — only
//    they may hold the automation/muse roles
//  - api_tokens holds hashed bearer tokens for those accounts
//  - event_rsvps.source records who created an RSVP, so the sync only ever
//    removes RSVPs it added itself
export class AddMuseAndFacebookSync1785000000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('non_validated','member','moderator','admin','automation','muse')
        NOT NULL DEFAULT 'member'
    `);
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN is_automation_account TINYINT NOT NULL DEFAULT 0 AFTER role
    `);
    await queryRunner.query(`
      UPDATE users SET is_automation_account = 1 WHERE email = 'automation@dinnerbears.internal'
    `);

    await queryRunner.query(`
      CREATE TABLE api_tokens (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        token_prefix VARCHAR(16) NOT NULL,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME NULL,
        revoked_at DATETIME NULL,
        created_by INT UNSIGNED NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_api_tokens_token_hash (token_hash),
        KEY IDX_api_tokens_user (user_id),
        CONSTRAINT FK_api_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE event_rsvps
        ADD COLUMN source ENUM('member','admin','facebook_sync') NOT NULL DEFAULT 'member' AFTER bringing_item
    `);

  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN source`);
    await queryRunner.query(`DROP TABLE api_tokens`);
    await queryRunner.query(`DELETE FROM users WHERE role = 'muse'`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN is_automation_account`);
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('non_validated','member','moderator','admin','automation')
        NOT NULL DEFAULT 'member'
    `);
  }
}
