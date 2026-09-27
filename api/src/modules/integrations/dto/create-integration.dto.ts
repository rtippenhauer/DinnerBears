import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../../../database/entities/user.entity';

export class CreateIntegrationDto {
  // Becomes "<name>-automation" — e.g. "Muse" → "Muse-automation".
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, { message: 'Name may only contain letters, numbers, spaces, - and _' })
  name: string;

  // Defaults to Muse — the only automation role that uses an API token.
  @IsOptional()
  @IsIn([UserRole.AUTOMATION, UserRole.MUSE])
  role?: UserRole.AUTOMATION | UserRole.MUSE;
}
