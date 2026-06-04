import type {
  MeterPoint,
  EnergyData,
  Alert,
  PricingTier,
  ACControlStrategy,
  ACStatus,
  CompareData,
  CurrentPricing,
  EnergyTotals,
} from '../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const api = {
  getHealth: () => request<{ status: string; timestamp: string }>('/health'),

  getMeterPoints: () => request<MeterPoint[]>('/meter-points'),
  getMeterPoint: (id: string) => request<MeterPoint>(`/meter-points/${id}`),

  get24HourData: (id: string) => request<EnergyData[]>(`/energy-data/${id}/24h`),
  getCompareData: (id: string) => request<CompareData>(`/energy-data/${id}/compare`),

  getTotals: () => request<EnergyTotals>('/totals'),

  getAlerts: (includeAcknowledged = false, limit = 100) =>
    request<Alert[]>(`/alerts?include_ack=${includeAcknowledged}&limit=${limit}`),
  acknowledgeAlert: (id: string) =>
    request<{ success: boolean }>(`/alerts/${id}/acknowledge`, { method: 'POST' }),

  getPricingTiers: () => request<PricingTier[]>('/pricing'),
  updatePricingTiers: (tiers: PricingTier[]) =>
    request<{ success: boolean; tiers: PricingTier[] }>('/pricing', {
      method: 'POST',
      body: JSON.stringify(tiers),
    }),
  getCurrentPricing: () => request<CurrentPricing>('/pricing/current'),

  getACStrategy: () => request<ACControlStrategy>('/ac-control'),
  updateACStrategy: (strategy: ACControlStrategy) =>
    request<{ success: boolean; strategy: ACControlStrategy }>('/ac-control', {
      method: 'POST',
      body: JSON.stringify(strategy),
    }),
  getACStatus: () => request<ACStatus>('/ac-control/status'),
  getACRecommendation: () =>
    request<{
      shouldAdjust: boolean;
      recommendedTemp: number;
      adjustment: number;
      reason: string;
      estimatedSavings: number;
    }>('/ac-control/recommendation'),
  getACSavings: () =>
    request<{
      dailySavings: number;
      monthlySavings: number;
      co2Reduction: number;
      tempAdjustments: number[];
    }>('/ac-control/savings'),
};

export default api;
