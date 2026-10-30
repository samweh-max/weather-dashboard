'use client';

import type { Location } from '@/lib/types';
import type { ProviderOption } from './ui';
import { useJson } from './useJson';

export function useProviders(loc?: Location | null) {
  const qs = loc ? `?lat=${loc.latitude}&lon=${loc.longitude}${loc.countryCode ? `&cc=${loc.countryCode}` : ''}` : '';
  const { data } = useJson<{ providers: ProviderOption[] }>(`/api/providers${qs}`);
  return data?.providers ?? [];
}
