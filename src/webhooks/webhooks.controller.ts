import { Controller, Body, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { todo } from '../helpers/errors/todo';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ListWebhooksQueryDto } from './dto/list-webhooks-query.dto';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';

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
