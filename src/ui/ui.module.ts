import { Module } from '@nestjs/common';
import { UiController } from './ui.controller.js';

@Module({ controllers: [UiController] })
export class UiModule {}
