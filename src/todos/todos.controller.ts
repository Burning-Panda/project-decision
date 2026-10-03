import { Controller, Body, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { ListTodosQueryDto } from './dto/list-todos-query.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';

@Controller('todos')
@UseGuards(XUserGuard)
export class TodosController {
  @Get()
  list(@Query() query: ListTodosQueryDto) {
    throw new NotImplementedError('GET /todos');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTodoDto) {
    throw new NotImplementedError('PATCH /todos/:id');
  }
}
