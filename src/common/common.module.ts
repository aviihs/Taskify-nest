import { Global, Module } from '@nestjs/common';
import { EmailService } from './email/email.service';
import { DomainEventPublisher } from './events/domain-event-publisher';

/** Cross-cutting singletons available to every feature module. */
@Global()
@Module({
  providers: [EmailService, DomainEventPublisher],
  exports: [EmailService, DomainEventPublisher],
})
export class CommonModule {}
