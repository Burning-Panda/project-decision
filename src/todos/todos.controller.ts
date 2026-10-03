import { Controller, Body, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard.js';
import { todo } from '../helpers/errors/todo.js';
import { ListTodosQueryDto } from './dto/list-todos-query.dto.js';
import { UpdateTodoDto } from './dto/update-todo.dto.js';

@Controller('todos')
@UseGuards(XUserGuard)
export class TodosController {
  @Get()
  list(@Query() query: ListTodosQueryDto) {
    return todo('GET /todos');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTodoDto) {
    return todo('PATCH /todos/:id');
  }
}
