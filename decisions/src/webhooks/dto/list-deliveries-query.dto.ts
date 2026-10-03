export class ListDeliveriesQueryDto {
  status?: 'pending' | 'delivered' | 'failed' | 'cancelled';
  limit?: string;
  offset?: string;
}
