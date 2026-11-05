import { Module } from '@nestjs/common';
import { loadPolicyConfig } from './policy-config';

/** Injection token for the validated agents and users from data/policies.yaml. */
export const POLICY_CONFIG = Symbol('POLICY_CONFIG');

@Module({
  providers: [{ provide: POLICY_CONFIG, useFactory: () => loadPolicyConfig() }],
  exports: [POLICY_CONFIG],
})
export class PolicyModule {}
