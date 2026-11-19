import { Module } from '@nestjs/common';
import { ConfigService, parseConfig } from './config.service.js';

@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: () =>
        new ConfigService(Object.freeze(parseConfig(process.env))),
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
