export type MeterType = 'electricity' | 'water' | 'gas' | 'cooling';

export type EnergyStatus = 'normal' | 'warning' | 'alert';

export interface FloorArea {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  borderColor: string;
  dash: number[];
}

export interface FloorElement {
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
}

export interface FloorLayout {
  floor: number;
  name: string;
  areas: FloorArea[];
  stairs: FloorElement[];
  elevators: FloorElement[];
}

export interface CanvasConfig {
  width: number;
  height: number;
  padding: number;
  gridSize: number;
  background: {
    startColor: string;
    endColor: string;
  };
  gridColor: string;
}

export interface FloorPlanConfig {
  canvas: CanvasConfig;
  floorPlan: {
    borderRadius: number;
    backgroundColor: string;
    borderColor: string;
  };
  commonElements: {
    stairs: {
      fillColor: string;
      borderColor: string;
      count: number;
    };
    elevator: {
      fillColor: string;
      borderColor: string;
    };
  };
  floors: FloorLayout[];
}

export type AlertType = 'abnormal_usage' | 'power_factor' | 'transformer_overload';

export type AlertSeverity = 'warning' | 'critical';

export type PricingPeriod = 'peak' | 'flat' | 'valley';

export interface MeterPoint {
  id: string;
  name: string;
  type: MeterType;
  floor: number;
  position: { x: number; y: number };
  area: string;
  unit: string;
  model?: string;
  installDate?: string;
  ratedPower?: number;
  historicalAverage: number;
  location?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnergyData {
  id?: string;
  meterPointId: string;
  timestamp: string;
  value: number;
  unit: string;
  powerFactor?: number;
  transformerLoad?: number;
  co2Level?: number;
  occupancyCount?: number;
  indoorTemp?: number;
}

export interface EnergyDataWithStatus extends EnergyData {
  status: EnergyStatus;
  ratio: number;
}

export interface Alert {
  id: string;
  type: AlertType;
  meterPointId: string;
  meterPointName: string;
  meterType: MeterType;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
  startTime: string;
  durationMinutes?: number;
  acknowledged: boolean;
  acknowledgedAt?: string;
  createdAt?: string;
}

export interface PricingTier {
  id: string;
  period: PricingPeriod;
  startTime: string;
  endTime: string;
  price: number;
  daysOfWeek: number[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ACControlStrategy {
  id?: number;
  enabled: boolean;
  baseTemperature: number;
  peakAdjustment: number;
  flatAdjustment: number;
  peakTempAdjustment?: number;
  normalSetPoint?: number;
  minSetPoint?: number;
  maxSetPoint?: number;
  co2Threshold: number;
  occupancyThreshold: number;
  tempLimitHigh: number;
  co2ConstraintEnabled: boolean;
  occupancyConstraintEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EnergyTotals {
  electricity: number;
  water: number;
  gas: number;
  cooling: number;
  currentCost: number;
  currentElectricityCost: number;
  todayCost: number;
  monthCost: number;
  currentPrice: number;
  currentPeriod: PricingPeriod;
  trends: {
    electricity: number;
    water: number;
    gas: number;
    cooling: number;
  };
  electricityUnit: string;
  waterUnit: string;
  gasUnit: string;
  coolingUnit: string;
  serverTimestamp: string;
}

export interface TrendDataPoint {
  timestamp: string;
  value: number;
}

export interface CompareData {
  today: number;
  yesterday: number;
  lastWeek: number;
  current?: TrendDataPoint[];
  yesterdayData?: TrendDataPoint[];
  lastWeekData?: TrendDataPoint[];
  currentTotal?: number;
  yesterdayTotal?: number;
  lastWeekTotal?: number;
  yoyChange: number;
  momChange: number;
}

export interface CurrentPricing {
  period: PricingPeriod;
  price: number;
  startTime: string;
  endTime: string;
  nextPeriod: PricingPeriod;
  nextPrice: number;
  nextStartTime: string;
  todayCost: number;
  monthCost: number;
  currentTier: PricingTier;
  nextTier: PricingTier;
  dailyCost: number;
}

export interface ACStatus {
  currentSetPoint: number;
  isPeakMode: boolean;
  adjustmentApplied: number;
  strategy?: ACControlStrategy;
  currentTemp: number;
  baseTemp: number;
  adjustment: number;
  isAdjusted: boolean;
  currentPeriod: PricingPeriod;
  co2Level?: number;
  occupancyCount?: number;
  indoorTemp?: number;
  co2Constrained?: boolean;
  occupancyConstrained?: boolean;
  adjustmentReduced?: boolean;
  constraintReason?: string;
  serverTimestamp?: string;
}

export type WSMessage =
  | { type: 'data_report'; data: EnergyData[] }
  | { type: 'alert_push'; data: Alert }
  | { type: 'totals_update'; data: EnergyTotals }
  | { type: 'meter_points'; data: MeterPoint[] }
  | { type: 'ac_status'; data: ACStatus };

export const METER_UNITS: Record<MeterType, string> = {
  electricity: 'kWh',
  water: 'm³',
  gas: 'm³',
  cooling: 'kWh',
};

export const METER_LABELS: Record<MeterType, string> = {
  electricity: '电表',
  water: '水表',
  gas: '燃气表',
  cooling: '冷量表',
};

export const STATUS_COLORS: Record<EnergyStatus, string> = {
  normal: '#10B981',
  warning: '#F59E0B',
  alert: '#EF4444',
};

export const STATUS_GLOW: Record<EnergyStatus, string> = {
  normal: 'rgba(16, 185, 129, 0.6)',
  warning: 'rgba(245, 158, 11, 0.6)',
  alert: 'rgba(239, 68, 68, 0.6)',
};

export const METER_TYPE_COLORS: Record<MeterType, string> = {
  electricity: '#f59e0b',
  water: '#3b82f6',
  gas: '#ef4444',
  cooling: '#06b6d4',
};
