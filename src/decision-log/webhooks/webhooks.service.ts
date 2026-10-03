import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo';
import type { CreateWebhookDto } from '../../webhooks/dto/create-webhook.dto';
import type { ListDeliveriesQueryDto } from '../../webhooks/dto/list-deliveries-query.dto';
import { AccessService } from '../core/access.service';
import { LogContext } from '../core/log-context';

/** Webhook registry and delivery log. Sending itself stays in WebhookDispatcher. */
@Injectable()
export class WebhooksService {
  constructor(private readonly ctx: LogContext, private readonly access: AccessService) {}

  create(_input: CreateWebhookDto & { actor: string }): any { return todo('WebhooksService.create'); }
  list(_owner: string, _actor: string): any { return todo('WebhooksService.list'); }
  remove(_id: string, _actor: string): any { return todo('WebhooksService.remove'); }
  deliveries(_webhookId: string, _actor: string, _query?: ListDeliveriesQueryDto): any { return todo('WebhooksService.deliveries'); }
  redeliver(_deliveryId: string, _actor: string): any { return todo('WebhooksService.redeliver'); }
  secret(_hook: { id: string; secret_enc: string }): string { return todo('WebhooksService.secret'); }
  pruneOutbox(_opts?: { olderThanDays?: number }): any { return todo('WebhooksService.pruneOutbox'); }
  pruneChannelDeliveries(_opts?: { olderThanDays?: number }): any { return todo('WebhooksService.pruneChannelDeliveries'); }
}
