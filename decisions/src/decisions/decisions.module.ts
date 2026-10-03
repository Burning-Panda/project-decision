import { Module } from '@nestjs/common';
import { DecisionsController } from './decisions.controller.js';

@Module({ controllers: [DecisionsController] })
export class DecisionsModule {}
