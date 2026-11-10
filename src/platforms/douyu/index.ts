import type { PlatformPresentation } from '../../shared/app-contracts.ts';
import { build } from './presentation.cjs';

export const adapter: PlatformPresentation = Object.freeze({
  id: 'douyu',
  version: '2026.11.07.3',
  build,
});
