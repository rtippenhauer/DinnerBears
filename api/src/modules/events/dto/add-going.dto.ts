import { IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';

export class AddGoingDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  additionalGuests?: number;
}
