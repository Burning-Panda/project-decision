export class UpdateTodoDto {
  status?: 'pending' | 'in_progress' | 'completed';
  notes?: string;
}
