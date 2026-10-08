import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from './domain-events';

/** Typed facade over the event bus so services can only publish known domain events. */
@Injectable()
export class DomainEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  publish(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }
}
