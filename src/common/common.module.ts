import { Global, Module } from '@nestjs/common';
import { TransactionRunner } from './database/transaction-runner';
import { EmailService } from './email/email.service';
import { DomainEventPublisher } from './events/domain-event-publisher';

/** Cross-cutting singletons available to every feature module. */
@Global()
@Module({
  providers: [EmailService, DomainEventPublisher, TransactionRunner],
  exports: [EmailService, DomainEventPublisher, TransactionRunner],
})
export class CommonModule {}
