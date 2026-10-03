import { MeetingSegmentDto } from './meeting-segment.dto.js';

export class AddMeetingPayloadDto {
  recorded_at?: string;
  duration_seconds?: number;
  attendees?: string[];
  audio_file_url?: string;
  segments?: MeetingSegmentDto[];
  transcript_text?: string;
  key_takeaways?: string[];
}
