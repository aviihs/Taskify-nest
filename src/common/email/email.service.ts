export class EmailService {
  private transporter: any;

  // constructor() {
  //   try {
  //     const nodemailer = require('nodemailer');

  //     this.transporter = nodemailer.createTransport({
  //       host: process.env.SMTP_HOST,
  //       port: Number(process.env.SMTP_PORT) || 587,
  //       secure: process.env.SMTP_SECURE === 'true',
  //       auth: {
  //         user: process.env.SMTP_USER,
  //         pass: process.env.SMTP_PASS,
  //       },
  //     });
  //   } catch (err) {
  //     this.transporter = null;
  //   }
  // }

  constructor() {
    const nodemailer = require('nodemailer');

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    this.transporter.verify((error, success) => {
      if (error) {
        console.log('SMTP ERROR:', error);
      } else {
        console.log('SMTP SERVER READY');
      }
    });
  }

  async sendMail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ) {
    try {
      if (!this.transporter) return;

      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        text,
        html,
      });
    } catch (err) {
      console.error('Email Service Error:', err);
      // Log the full error response
      if (err.response) {
        console.error('Response:', err.response);
      }
    }
  }
}