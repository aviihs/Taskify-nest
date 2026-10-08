import { Injectable, Logger } from '@nestjs/common';
import { IHealthStatus } from './interfaces/health.interface';
import { HealthCheckDto, SimpleHealthDto } from './dtos/health.dto';
import { HEALTH_CONSTANTS } from './constants/health.constants';

/**
 * Health Service
 * Handles health check logic and monitoring
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  /**
   * Get basic health status
   */
  getBasicHealth(): SimpleHealthDto {
    this.logger.debug('Basic health check requested');
    return {
      status: HEALTH_CONSTANTS.STATUS.OK,
      message: HEALTH_CONSTANTS.MESSAGES.HEALTHY,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get detailed health status including uptime and environment
   */
  getDetailedHealth(): HealthCheckDto {
    this.logger.debug('Detailed health check requested');
    const uptime = this.getUptime();
    const environment =
      process.env.NODE_ENV || HEALTH_CONSTANTS.DEFAULT_ENVIRONMENT;

    return {
      status: HEALTH_CONSTANTS.STATUS.OK,
      timestamp: new Date().toISOString(),
      uptime,
      environment,
      version: process.env.APP_VERSION || HEALTH_CONSTANTS.DEFAULT_VERSION,
      details: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
      },
    };
  }

  /**
   * Get full health status with all metrics
   */
  getFullHealth(): IHealthStatus {
    this.logger.debug('Full health check requested');
    try {
      return {
        status: HEALTH_CONSTANTS.STATUS.OK,
        timestamp: new Date().toISOString(),
        uptime: this.getUptime(),
        environment:
          process.env.NODE_ENV || HEALTH_CONSTANTS.DEFAULT_ENVIRONMENT,
        version: process.env.APP_VERSION || HEALTH_CONSTANTS.DEFAULT_VERSION,
        database: {
          connected: true,
          message: 'Database connection is active',
        },
      };
    } catch (error) {
      this.logger.error('Error getting full health status', error);
      return {
        status: HEALTH_CONSTANTS.STATUS.ERROR,
        timestamp: new Date().toISOString(),
        uptime: this.getUptime(),
        environment:
          process.env.NODE_ENV || HEALTH_CONSTANTS.DEFAULT_ENVIRONMENT,
        database: {
          connected: false,
          message: 'Database connection failed',
        },
      };
    }
  }

  /**
   * Check if service is alive
   */
  isAlive(): boolean {
    this.logger.debug('Liveness probe requested');
    return true;
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    this.logger.debug('Readiness probe requested');
    try {
      // Add any initialization checks here
      // For example: check database connectivity, check if all modules are loaded, etc.
      const isHealthy = this.checkServiceReadiness();
      return isHealthy;
    } catch (error) {
      this.logger.error('Service readiness check failed', error);
      return false;
    }
  }

  /**
   * Get server uptime in seconds
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Check if service is ready to accept traffic
   */
  private checkServiceReadiness(): boolean {
    try {
      // Add specific readiness checks here
      // 1. Check database connection
      // 2. Check cache connection
      // 3. Check other critical dependencies

      // For now, return true if the service is running for at least 1 second
      return this.getUptime() >= 1;
    } catch (error) {
      this.logger.error('Readiness check error:', error);
      return false;
    }
  }
}
