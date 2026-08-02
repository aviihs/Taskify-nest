import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { env } from './common/config/env.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        );
        return new BadRequestException(
          messages.length ? messages : 'Invalid request payload',
        );
      },
    }),
  );

  // Swagger/OpenAPI configuration
  const config = new DocumentBuilder()
    .setTitle('Taskify API')
    .setDescription(
      'A polished task management API with authentication, task ownership, and comprehensive health monitoring.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health', 'Health check and monitoring endpoints')
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Task', 'Task management endpoints')
    .addTag('Users', 'User management endpoints')
    .addTag('Root', 'API root endpoint')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document, {
    customSiteTitle: 'Taskify API Docs',
    explorer: true,
    swaggerOptions: {
      persistAuthorization: true,
      tryItOutEnabled: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'method',
      defaultModelsExpandDepth: 1,
    },
  });

  const port = env.port || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`✓ Application is running on http://localhost:${port}`);
  logger.log(
    `✓ Swagger documentation available at http://localhost:${port}/api`,
  );
  logger.log(`✓ Health check available at http://localhost:${port}/health`);
}
bootstrap();

// get refresh tokens
// change password
// logout

// .env
// config
