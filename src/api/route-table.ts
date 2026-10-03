import { Injectable, RequestMethod } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { joinRoutePath } from '../helpers/routing/join-route-path';
import { routePattern } from '../helpers/routing/route-pattern';

interface Entry { method: string; re: RegExp }

/** Built from the registered controllers, so it can never drift from the real routes. */
@Injectable()
export class RouteTable {
  private entries: Entry[] | null = null;

  constructor(private readonly discovery: DiscoveryService) {}

  /** Methods registered for a concrete path (empty when the path is not routed at all). */
  methodsFor(path: string): string[] {
    return [...new Set(this.table().filter((e) => e.re.test(path)).map((e) => e.method))];
  }

  private table(): Entry[] {
    if (this.entries) return this.entries;
    const entries: Entry[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const ctor = wrapper.metatype as (new (...a: any[]) => unknown) | null;
      if (!ctor) continue;
      const base = Reflect.getMetadata('path', ctor) ?? '';
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
        const handler = (ctor.prototype as any)[name];
        const method = typeof handler === 'function' ? Reflect.getMetadata('method', handler) : undefined;
        if (method === undefined) continue;
        const path = joinRoutePath(base, Reflect.getMetadata('path', handler) ?? '');
        entries.push({ method: RequestMethod[method], re: routePattern(path) });
      }
    }
    return (this.entries = entries);
  }
}
