import { Controller, Body, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { CreateDecisionDto } from './dto/create-decision.dto';
import { ListDecisionsQueryDto } from './dto/list-decisions-query.dto';
import { PerformActionDto } from './dto/perform-action.dto';
import { VersionsQueryDto } from './dto/versions-query.dto';
import { DiffQueryDto } from './dto/diff-query.dto';
import { AddCommentDto } from './dto/add-comment.dto';

@Controller('decisions')
@UseGuards(XUserGuard)
export class DecisionsController {
  @Post()
  create(@Body() body: CreateDecisionDto) {
    throw new NotImplementedError('POST /decisions');
  }

  @Get()
  list(@Query() query: ListDecisionsQueryDto) {
    throw new NotImplementedError('GET /decisions');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id');
  }

  @Get(':id/document')
  document(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id/document');
  }

  @Post(':id/actions')
  perform(@Param('id') id: string, @Body() body: PerformActionDto) {
    throw new NotImplementedError('POST /decisions/:id/actions');
  }

  @Get(':id/versions')
  versions(@Param('id') id: string, @Query() query: VersionsQueryDto) {
    throw new NotImplementedError('GET /decisions/:id/versions');
  }

  @Get(':id/diff')
  diff(@Param('id') id: string, @Query() query: DiffQueryDto) {
    throw new NotImplementedError('GET /decisions/:id/diff');
  }

  @Get(':id/comments')
  listComments(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id/comments');
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() body: AddCommentDto) {
    throw new NotImplementedError('POST /decisions/:id/comments');
  }

  @Get(':id/participants')
  participants(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id/participants');
  }

  @Get(':id/related')
  related(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id/related');
  }

  @Get(':id/integrity')
  integrity(@Param('id') id: string) {
    throw new NotImplementedError('GET /decisions/:id/integrity');
  }
}
