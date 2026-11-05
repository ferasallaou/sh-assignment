/**
 * Shared types: the contracts between modules (sources, access, knowledge, models, sync, agent).
 * Import them from here: `import type { SourceRecord } from '../types'`.
 *
 * Rule: this folder holds types only, no runtime code (enforced by ESLint).
 * Types used by only one file stay next to that file.
 */
export type * from './access';
export type * from './agent';
export type * from './api';
export type * from './knowledge';
export type * from './models';
export type * from './sources';
export type * from './sync';
