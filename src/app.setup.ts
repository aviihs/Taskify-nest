import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const flattenConstraints = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenConstraints(error.children ?? []),
  ]);

/** Request pipeline shared by the server and the e2e tests, so tests exercise production behaviour. */
export function configureApp(app: INestApplication): INestApplication {
  // Public brand assets (logo/favicon). Copied to dist/assets by nest-cli.
  (app as NestExpressApplication).useStaticAssets(join(__dirname, 'assets'), {
    prefix: '/assets/',
    maxAge: '7d',
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const messages = flattenConstraints(errors);
        return new BadRequestException(
          messages.length ? messages : 'Invalid request payload',
        );
      },
    }),
  );
  return app;
}
