import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Field names match what Muse already produces (snake_case), so it can post
// its extraction as-is.

export class FacebookGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  // The person's current profile link (vanity URL), e.g.
  // https://www.facebook.com/funktryboy. Stored as-is on each sync, so a
  // changed vanity simply updates.
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  profile_url: string;

  // The numeric Facebook profile ID — the permanent key for this person.
  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'facebook_user_id must be the numeric Facebook profile ID' })
  facebook_user_id: string;

  // Names of the +1s read from the Facebook comments. These are only ever
  // matched to a member's website guests by exact name — a Facebook +1 is
  // never assumed to be one of the guests already on the website.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  plus_one_names?: string[];

  // Total +1s, for comments like "+1" with no name. The unnamed count is
  // whatever this adds beyond plus_one_names.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  plus_ones?: number;
}

export class FacebookEventSyncDto {
  @IsInt()
  @IsPositive()
  dinnerbears_event_id: number;

  @IsString()
  @Matches(/^\d{1,32}$/, { message: 'facebook_event_id must be the digits from the Facebook event URL' })
  facebook_event_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facebook_group?: string;

  // How many people Facebook says are Going. If it doesn't match the guests
  // sent, the list is treated as partial: nobody is removed for this event.
  @IsOptional()
  @IsInt()
  @Min(0)
  going_count?: number;

  // Everyone on the Going tab. Not "Interested".
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FacebookGuestDto)
  guests: FacebookGuestDto[];

  // Informational only.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  facebook_event_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}

export class FacebookSyncDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FacebookEventSyncDto)
  events: FacebookEventSyncDto[];

  // When Muse read these lists. A Facebook event whose last applied list is
  // newer is skipped, so a late-arriving older run can't undo a newer one.
  @IsOptional()
  @IsDateString()
  extracted_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class LinkFacebookEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  group?: string;
}
