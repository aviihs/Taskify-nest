import { Injectable } from '@nestjs/common';
import { env } from './common/config/env.config';
import { HEALTH_CONSTANTS } from './health/constants/health.constants';
import { renderLandingPage } from './landing/landing-page';

@Injectable()
export class AppService {
  getHello(): string {
    return renderLandingPage({
      version: process.env.APP_VERSION || HEALTH_CONSTANTS.DEFAULT_VERSION,
      environment: env.nodeEnv,
      uptimeSeconds: process.uptime(),
    });
  }
}
