import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class FacebookAttendeeDto {
  // The name as Facebook shows it. Matched case-insensitively against members'
  // full names.
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  // +1s read from the Facebook comments.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  plusOnes?: number;

  // Skip name matching and use this member directly — for someone whose
  // Facebook name doesn't match their website name.
  @IsOptional()
  @IsInt()
  @IsPositive()
  userId?: number;
}

export class FacebookSyncDto {
  // Everyone currently marked Going on the Facebook event. "Interested" does
  // not count and must not be sent. The list is authoritative for this run:
  // anyone the sync previously added who is missing from it gets removed.
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FacebookAttendeeDto)
  attendees: FacebookAttendeeDto[];
}
