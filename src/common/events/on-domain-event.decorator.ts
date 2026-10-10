import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventType } from './domain-events';

const logger = new Logger('DomainEventListener');

/**
 * Subscribes a method to one or more domain events and isolates failures:
 * side effects (activity, notifications, realtime) are best-effort and must
 * never crash the process or affect the request that emitted the event.
 */
export function OnDomainEvent(
  ...events: Array<DomainEventType | string>
): MethodDecorator {
  return (target, key, descriptor: PropertyDescriptor) => {
    const handler = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      try {
        await handler.apply(this, args);
      } catch (error) {
        logger.error(
          `${target.constructor.name}.${String(key)} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    };
    for (const event of events) {
      OnEvent(event, { async: true })(target, key, descriptor);
    }
    return descriptor;
  };
}
