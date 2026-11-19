import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from './shared/config/config.service.js';
import { parseConfig } from './shared/config/config.service.js';
import { configureHttp } from './shared/http/configure-http.js';

async function bootstrap() {
  // Validate before Nest's logger can print an exception containing input values.
  try {
    parseConfig(process.env);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    abortOnError: false,
  });
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).values.apiPort, '0.0.0.0');
}

void bootstrap().catch(() => {
  console.error(
    'API startup failed. Check local configuration and port availability.',
  );
  process.exitCode = 1;
});
