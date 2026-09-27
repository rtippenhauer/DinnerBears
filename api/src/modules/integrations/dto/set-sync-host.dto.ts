import { IsInt, IsPositive } from 'class-validator';

export class SetSyncHostDto {
  @IsInt()
  @IsPositive()
  userId: number;
}
