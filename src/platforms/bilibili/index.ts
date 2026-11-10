import type { PlatformPresentation } from '../../shared/app-contracts.ts';
import { build } from './presentation.cjs';

export const adapter: PlatformPresentation = {
  id: 'bilibili',
  version: '2026.11.07.4',
  build,
};
