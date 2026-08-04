import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: any;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer');

    const missingConfig = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'EMAIL_FROM',
    ].filter((key) => !process.env[key]);

    if (missingConfig.length) {
      this.logger.warn(
        `SMTP not configured. Missing: ${missingConfig.join(', ')}`,
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000),
      greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 15000),
      socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 15000),
    });

    this.transporter.verify((error) => {
      if (error) {
        this.logger.error('SMTP verification failed', error);
      } else {
        this.logger.log('SMTP server ready');
      }
    });
  }

  async sendMail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    if (!this.transporter) {
      throw new InternalServerErrorException('SMTP is not configured');
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        text,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${info.messageId}`);
    } catch (err) {
      this.logger.error(`Email send failed to ${to}`, err);
      throw new InternalServerErrorException('Failed to send email');
    }
  }
}
