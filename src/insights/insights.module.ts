import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller.js';

@Module({ controllers: [InsightsController] })
export class InsightsModule {}
