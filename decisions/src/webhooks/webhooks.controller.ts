import { Controller, Body, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard.js';
import { todo } from '../helpers/errors/todo.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { ListWebhooksQueryDto } from './dto/list-webhooks-query.dto.js';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto.js';

@Controller()
@UseGuards(XUserGuard)
export class WebhooksController {
  @Post('webhooks')
  create(@Body() body: CreateWebhookDto) {
    return todo('POST /webhooks');
  }

  @Get('webhooks')
  list(@Query() query: ListWebhooksQueryDto) {
    return todo('GET /webhooks');
  }

  @Delete('webhooks/:id')
  remove(@Param('id') id: string) {
    return todo('DELETE /webhooks/:id');
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Param('id') id: string, @Query() query: ListDeliveriesQueryDto) {
    return todo('GET /webhooks/:id/deliveries');
  }

  @Post('deliveries/:id/redeliver')
  redeliver(@Param('id') id: string) {
    return todo('POST /deliveries/:id/redeliver');
  }
}
