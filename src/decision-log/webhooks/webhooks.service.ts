import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { CreateWebhookDto } from '../../webhooks/dto/create-webhook.dto';
import type { ListDeliveriesQueryDto } from '../../webhooks/dto/list-deliveries-query.dto';
import { AccessService } from '../core/access.service';
import { LogContext } from '../core/log-context';

/** Webhook registry and delivery log. Sending itself stays in WebhookDispatcher. */
@Injectable()
export class WebhooksService {
  constructor(private readonly ctx: LogContext, private readonly access: AccessService) {}

  create(_input: CreateWebhookDto & { actor: string }): any { throw new NotImplementedError('WebhooksService.create'); }
  list(_owner: string, _actor: string): any { throw new NotImplementedError('WebhooksService.list'); }
  remove(_id: string, _actor: string): any { throw new NotImplementedError('WebhooksService.remove'); }
  deliveries(_webhookId: string, _actor: string, _query?: ListDeliveriesQueryDto): any { throw new NotImplementedError('WebhooksService.deliveries'); }
  redeliver(_deliveryId: string, _actor: string): any { throw new NotImplementedError('WebhooksService.redeliver'); }
  secret(_hook: { id: string; secret_enc: string }): string { throw new NotImplementedError('WebhooksService.secret'); }
  pruneOutbox(_opts?: { olderThanDays?: number }): any { throw new NotImplementedError('WebhooksService.pruneOutbox'); }
  pruneChannelDeliveries(_opts?: { olderThanDays?: number }): any { throw new NotImplementedError('WebhooksService.pruneChannelDeliveries'); }
}
