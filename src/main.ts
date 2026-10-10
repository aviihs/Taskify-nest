import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { assertRequiredEnv, env } from './common/config/env.config';

async function bootstrap() {
  assertRequiredEnv();
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin: env.corsOrigins.length ? env.corsOrigins : true,
    credentials: true,
  });

  configureApp(app);

  // Swagger/OpenAPI configuration
  const config = new DocumentBuilder()
    .setTitle('Taskify API')
    .setDescription(
      'Taskify API: personal and organization workspaces, projects, tasks and collaboration.',
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

  const port = env.port;
  await app.listen(port, '0.0.0.0');
  logger.log(`✓ Application is running on http://localhost:${port}`);
  logger.log(
    `✓ Swagger documentation available at http://localhost:${port}/api`,
  );
  logger.log(`✓ Health check available at http://localhost:${port}/health`);
}
bootstrap();
