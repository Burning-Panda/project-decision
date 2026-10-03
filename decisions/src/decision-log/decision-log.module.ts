import { DynamicModule, Module } from '@nestjs/common';
import { DecisionLog } from './decision-log.js';

export const DECISION_LOG_OPTIONS = Symbol('DECISION_LOG_OPTIONS')

@Module({})
export class DecisionLogModule {
  static register(options: Record<string, any> = {}): DynamicModule {
    return {
      module: DecisionLogModule,
      providers: [
        { provide: DECISION_LOG_OPTIONS, useValue: options },
        { provide: DecisionLog, useFactory: (o: Record<string, any>) => new DecisionLog(o), inject: [ DECISION_LOG_OPTIONS ] }
      ],
      exports: [ DecisionLog ]
    }
  }
}
