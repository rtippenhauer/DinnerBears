import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

// Bearer tokens for integration accounts (Phase 39). Only the SHA-256 of the
// token is stored; the plaintext is shown exactly once, when it's issued.
// Each integration keeps at most one live token — issuing or rotating revokes
// the previous one.
@Entity('api_tokens')
export class ApiTokenEntity {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'user_id', unsigned: true })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  // First few characters of the plaintext, so an admin can tell tokens apart.
  @Column({ name: 'token_prefix', type: 'varchar', length: 16 })
  tokenPrefix: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'last_used_at', type: 'datetime', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt: Date | null;

  // Admin who issued it, or null when the integration rotated its own token.
  @Column({ name: 'created_by', type: 'int', unsigned: true, nullable: true })
  createdById: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
