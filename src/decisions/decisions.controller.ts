import { Controller, Body, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard.js';
import { todo } from '../helpers/errors/todo.js';
import { CreateDecisionDto } from './dto/create-decision.dto.js';
import { ListDecisionsQueryDto } from './dto/list-decisions-query.dto.js';
import { PerformActionDto } from './dto/perform-action.dto.js';
import { VersionsQueryDto } from './dto/versions-query.dto.js';
import { DiffQueryDto } from './dto/diff-query.dto.js';
import { AddCommentDto } from './dto/add-comment.dto.js';

@Controller('decisions')
@UseGuards(XUserGuard)
export class DecisionsController {
  @Post()
  create(@Body() body: CreateDecisionDto) {
    return todo('POST /decisions');
  }

  @Get()
  list(@Query() query: ListDecisionsQueryDto) {
    return todo('GET /decisions');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return todo('GET /decisions/:id');
  }

  @Get(':id/document')
  document(@Param('id') id: string) {
    return todo('GET /decisions/:id/document');
  }

  @Post(':id/actions')
  perform(@Param('id') id: string, @Body() body: PerformActionDto) {
    return todo('POST /decisions/:id/actions');
  }

  @Get(':id/versions')
  versions(@Param('id') id: string, @Query() query: VersionsQueryDto) {
    return todo('GET /decisions/:id/versions');
  }

  @Get(':id/diff')
  diff(@Param('id') id: string, @Query() query: DiffQueryDto) {
    return todo('GET /decisions/:id/diff');
  }

  @Get(':id/comments')
  listComments(@Param('id') id: string) {
    return todo('GET /decisions/:id/comments');
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() body: AddCommentDto) {
    return todo('POST /decisions/:id/comments');
  }

  @Get(':id/participants')
  participants(@Param('id') id: string) {
    return todo('GET /decisions/:id/participants');
  }

  @Get(':id/related')
  related(@Param('id') id: string) {
    return todo('GET /decisions/:id/related');
  }

  @Get(':id/integrity')
  integrity(@Param('id') id: string) {
    return todo('GET /decisions/:id/integrity');
  }
}
