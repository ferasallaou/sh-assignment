import { Module } from '@nestjs/common';
import { MockHrSystem } from './mock-hr-system';

/** Injection token for the live HR system. */
export const HR_SYSTEM = Symbol('HR_SYSTEM');

@Module({
  providers: [{ provide: HR_SYSTEM, useFactory: () => new MockHrSystem() }],
  exports: [HR_SYSTEM],
})
export class HrModule {}
