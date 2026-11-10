import type { PlatformPresentation } from '../../shared/app-contracts.ts';
import { build } from './presentation.cjs';

export const adapter: PlatformPresentation = {
  id: 'huya',
  version: '2026.11.08.2',
  build,
};
