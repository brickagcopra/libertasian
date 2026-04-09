import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PerformanceInterceptor } from './common/interceptors/performance.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Cookie parsing for httpOnly refresh token cookies
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: process.env['APP_URL'] || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe per CLAUDE.md security standards
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global performance interceptor — logs response times, detects slow endpoints
  app.useGlobalInterceptors(new PerformanceInterceptor());

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation (disabled in production)
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('LIBERTASIAN API')
      .setDescription('Philippine Legal AI Platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env['APP_PORT'] || 3001;
  await app.listen(port);
}

void bootstrap();
