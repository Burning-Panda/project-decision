import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AdminModule } from '../admin/admin.module.js';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { InsightsModule } from '../insights/insights.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { TodosModule } from '../todos/todos.module.js';
import { UiModule } from '../ui/ui.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { type ApiOptions } from './api-options.js';
import { ApiCoreModule } from './api-core.module.js';
import { DecisionLogErrorFilter } from './decision-log-error.filter.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { OnMutationInterceptor } from './on-mutation.interceptor.js';
import { RouteTable } from './route-table.js';

/** The HTTP API: composes the feature modules and the cross-cutting filter/interceptors. */
@Module({})
export class ApiModule {
  static register(options: ApiOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        DiscoveryModule,
        ApiCoreModule.register(options),
        AdminModule, DecisionsModule, TodosModule, WebhooksModule, ProfileModule, InsightsModule, UiModule,
      ],
      providers: [
        RouteTable,
        { provide: APP_FILTER, useClass: DecisionLogErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: OnMutationInterceptor },
      ],
    };
  }
}
