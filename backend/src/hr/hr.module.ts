import { Module } from '@nestjs/common';
import { loadConfig } from '../config';
import { HrApiClient } from './hr-api.client';

/** Injection token for the live HR system. */
export const HR_SYSTEM = Symbol('HR_SYSTEM');

@Module({
  providers: [
    {
      provide: HR_SYSTEM,
      useFactory: () => {
        const config = loadConfig();
        return new HrApiClient(config.HR_API_URL ?? `http://127.0.0.1:${config.HR_API_PORT}`, config.HR_SERVICE_KEY);
      },
    },
  ],
  exports: [HR_SYSTEM],
})
export class HrModule {}
