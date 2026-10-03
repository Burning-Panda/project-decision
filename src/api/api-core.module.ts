import { DynamicModule, Global, Module } from '@nestjs/common';
import { DecisionLog } from '../decision-log/decision-log';
import { API_OPTIONS, type ApiOptions } from './api-options';

/** Makes the injected DecisionLog and API options visible to every feature module. */
@Global()
@Module({})
export class ApiCoreModule {
  static register(options: ApiOptions): DynamicModule {
    const providers = [
      { provide: API_OPTIONS, useValue: options },
      { provide: DecisionLog, useValue: options.log },
    ];
    return { module: ApiCoreModule, providers, exports: providers.map((p) => p.provide) };
  }
}
