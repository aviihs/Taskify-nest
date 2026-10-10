import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend?: Resend;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY is not configured; emails are disabled');
      return;
    }
    this.resend = new Resend(apiKey);
  }

  get isConfigured(): boolean {
    return Boolean(this.resend);
  }

  async sendMail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    if (!this.resend) {
      throw new InternalServerErrorException('Email is not configured');
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `Taskify <${process.env.EMAIL_FROM}>`,
        to,
        subject,
        text,
        html,
      });
      if (error) throw new Error(error.message);
      this.logger.log(`Email ${data?.id} sent`);
    } catch (err) {
      this.logger.error('Failed to send email', err);
      throw new InternalServerErrorException('Failed to send email');
    }
  }
}
