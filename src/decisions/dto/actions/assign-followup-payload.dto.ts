export class AssignFollowupPayloadDto {
  title: string;
  assigned_to: string;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high';
  description?: string;
}
