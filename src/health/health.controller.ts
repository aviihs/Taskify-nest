import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiInternalServerErrorResponse,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { HealthService } from './health.service';
import {
  HealthCheckDto,
  SimpleHealthDto,
  LivenessProbeDto,
  ReadinessProbeDto,
} from './dtos/health.dto';
import { IHealthStatus } from './interfaces/health.interface';
import { Public } from '../common/decorators/public.decorator';

/**
 * Health Controller
 * Provides endpoints for health check and monitoring
 *
 * Health endpoints are crucial for:
 * - Load balancing and traffic routing
 * - Container orchestration (Kubernetes)
 * - Monitoring and alerting systems
 * - CI/CD pipelines
 * - Health dashboards
 */
@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Simple health check endpoint
   * GET /health
   *
   * Returns a minimal response to quickly verify the service is responding.
   * Lightweight endpoint suitable for frequent health checks.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Basic Health Check',
    description: `
      Returns a simple health status to verify the service is running.
      
      This is the most lightweight endpoint for basic liveness checks.
      Perfect for quick status verification and load balancer probes.
      
      **Response Time**: < 1ms
      **Use Case**: Quick status checks, load balancer pings
    `,
    externalDocs: {
      description: 'Health Check Best Practices',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/',
    },
  })
  @ApiOkResponse({
    description: 'Service is healthy and responding',
    type: SimpleHealthDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Service is experiencing issues',
    schema: {
      example: {
        status: 'error',
        message: 'Service is experiencing issues',
        timestamp: '2024-01-15T10:30:45.123Z',
      },
    },
  })
  checkHealth(): SimpleHealthDto {
    return this.healthService.getBasicHealth();
  }

  /**
   * Detailed health check endpoint with uptime and environment
   * GET /health/detailed
   *
   * Returns comprehensive health information including system metrics,
   * memory usage, Node.js version, and environment details.
   */
  @Public()
  @Get('detailed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Detailed Health Check',
    description: `
      Returns detailed health information including uptime, environment, 
      memory metrics, and Node.js version information.
      
      Includes:
      - Server uptime in seconds
      - Current environment (development/production)
      - Application version
      - Memory usage (heap used, heap total, RSS)
      - Node.js version and platform
      
      **Response Time**: 1-5ms
      **Use Case**: Monitoring dashboards, detailed diagnostics
      **Data Updated**: Every request
    `,
    externalDocs: {
      description: 'Node.js Process Monitoring',
      url: 'https://nodejs.org/en/docs/guides/simple-profiling/',
    },
  })
  @ApiOkResponse({
    description: 'Detailed health information retrieved successfully',
    type: HealthCheckDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve detailed health information',
  })
  getDetailedHealth(): HealthCheckDto {
    return this.healthService.getDetailedHealth();
  }

  /**
   * Full health status with all metrics
   * GET /health/full
   *
   * Returns comprehensive health status including database connectivity
   * and all system metrics.
   */
  @Public()
  @Get('full')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Full Health Status',
    description: `
      Returns comprehensive health status with all system metrics and 
      database connectivity information.
      
      Includes everything from detailed endpoint plus:
      - Database connection status
      - Database availability message
      - Full system diagnostic information
      
      **Response Time**: 5-50ms (includes DB check)
      **Use Case**: Comprehensive monitoring, troubleshooting
      **Data Updated**: Every request
      **Note**: May be slower if database is experiencing issues
    `,
    externalDocs: {
      description: 'Database Health Monitoring',
      url: 'https://docs.mongodb.com/manual/administration/monitoring/',
    },
  })
  @ApiOkResponse({
    description: 'Complete health status with all metrics',
    type: HealthCheckDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to retrieve full health status',
    schema: {
      example: {
        status: 'error',
        timestamp: '2024-01-15T10:30:45.123Z',
        database: {
          connected: false,
          message: 'Database connection failed',
        },
      },
    },
  })
  getFullHealth(): IHealthStatus {
    return this.healthService.getFullHealth();
  }

  /**
   * Kubernetes Liveness Probe
   * GET /health/live
   *
   * Returns simple true/false to indicate if the service process is alive.
   * Used by Kubernetes for container liveness checks.
   */
  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kubernetes Liveness Probe',
    description: `
      Returns true if the service is alive (process is running).
      
      Used by Kubernetes to determine if the container should be restarted.
      If this endpoint fails, Kubernetes will restart the container.
      
      **Response Time**: < 1ms
      **Use Case**: Kubernetes liveness probe
      **HTTP Status**: Always 200 if alive, never returns error status
      
      ### Kubernetes Configuration Example:
      \`\`\`yaml
      livenessProbe:
        httpGet:
          path: /health/live
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 10
        timeoutSeconds: 2
        failureThreshold: 3
      \`\`\`
    `,
    externalDocs: {
      description: 'Kubernetes Liveness Probes',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-a-liveness-http-request',
    },
  })
  @ApiOkResponse({
    description: 'Service is alive and responding',
    type: LivenessProbeDto,
  })
  isAlive(): { alive: boolean } {
    return { alive: this.healthService.isAlive() };
  }

  /**
   * Kubernetes Readiness Probe
   * GET /health/ready
   *
   * Returns true if the service is ready to accept traffic.
   * Used by Kubernetes for load balancer routing decisions.
   */
  @Public()
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Kubernetes Readiness Probe',
    description: `
      Returns true if the service is ready to accept traffic.
      
      Used by Kubernetes to determine if the container should receive traffic.
      Returns false if the service is not initialized or dependencies are unavailable.
      
      **Response Time**: 1-10ms
      **Use Case**: Kubernetes readiness probe, traffic routing
      **HTTP Status**: Always 200, but false means not ready for traffic
      
      Checks performed:
      - Service initialization complete
      - All dependencies available
      - Minimum uptime (1+ seconds)
      
      ### Kubernetes Configuration Example:
      \`\`\`yaml
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 2
        failureThreshold: 2
      \`\`\`
    `,
    externalDocs: {
      description: 'Kubernetes Readiness Probes',
      url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes',
    },
  })
  @ApiOkResponse({
    description: 'Service ready status',
    type: ReadinessProbeDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'Service not ready or initialization failed',
  })
  isReady(): { ready: boolean } {
    return { ready: this.healthService.isReady() };
  }
}
