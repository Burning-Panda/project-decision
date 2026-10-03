import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';

@Module({ controllers: [InsightsController] })
export class InsightsModule {}
