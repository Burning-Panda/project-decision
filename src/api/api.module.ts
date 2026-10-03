import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AdminModule } from '../admin/admin.module';
import { DecisionsModule } from '../decisions/decisions.module';
import { InsightsModule } from '../insights/insights.module';
import { ProfileModule } from '../profile/profile.module';
import { TodosModule } from '../todos/todos.module';
import { UiModule } from '../ui/ui.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { type ApiOptions } from './api-options';
import { ApiCoreModule } from './api-core.module';
import { DecisionLogErrorFilter } from './decision-log-error.filter';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { OnMutationInterceptor } from './on-mutation.interceptor';
import { RouteTable } from './route-table';

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
