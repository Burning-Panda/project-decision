import { Module } from '@nestjs/common';
import { TodosController } from './todos.controller.js';

@Module({ controllers: [TodosController] })
export class TodosModule {}
