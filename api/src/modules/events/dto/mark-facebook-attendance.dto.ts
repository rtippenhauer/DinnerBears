import { IsBoolean } from 'class-validator';

export class MarkFacebookAttendanceDto {
  @IsBoolean()
  attended: boolean;
}
