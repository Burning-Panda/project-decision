import { Controller, Body, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ListWebhooksQueryDto } from './dto/list-webhooks-query.dto';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';

@Controller()
@UseGuards(XUserGuard)
export class WebhooksController {
  @Post('webhooks')
  create(@Body() body: CreateWebhookDto) {
    throw new NotImplementedError('POST /webhooks');
  }

  @Get('webhooks')
  list(@Query() query: ListWebhooksQueryDto) {
    throw new NotImplementedError('GET /webhooks');
  }

  @Delete('webhooks/:id')
  remove(@Param('id') id: string) {
    throw new NotImplementedError('DELETE /webhooks/:id');
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Param('id') id: string, @Query() query: ListDeliveriesQueryDto) {
    throw new NotImplementedError('GET /webhooks/:id/deliveries');
  }

  @Post('deliveries/:id/redeliver')
  redeliver(@Param('id') id: string) {
    throw new NotImplementedError('POST /deliveries/:id/redeliver');
  }
}
