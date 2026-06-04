import type { PricingTier, PricingPeriod } from '../../../shared/types';

export interface CurrentPricingResult {
  period: PricingPeriod;
  price: number;
  startTime: string;
  endTime: string;
  tier: PricingTier;
}

export interface NextPricingResult {
  period: PricingPeriod;
  price: number;
  startTime: string;
  tier: PricingTier;
}

export interface PricingAtTimeResult {
  period: PricingPeriod;
  price: number;
}

export interface CostCalculationOptions {
  values: { value: number; timestamp: Date }[];
  tiers: PricingTier[];
}

export interface DailyCostBreakdown {
  date: string;
  peakCost: number;
  flatCost: number;
  valleyCost: number;
  totalCost: number;
  peakUsage: number;
  flatUsage: number;
  valleyUsage: number;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export class PricingEngine {
  private static readonly MINUTES_IN_DAY = 24 * 60;

  static timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  static minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  static isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  static getTimeOfDay(date: Date): TimeOfDay {
    const hour = date.getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }

  static getCurrentPricing(tiers: PricingTier[], now: Date = new Date()): CurrentPricingResult {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const currentDayOfWeek = now.getDay();

    for (const tier of tiers) {
      if (tier.daysOfWeek && tier.daysOfWeek.length > 0 && !tier.daysOfWeek.includes(currentDayOfWeek)) {
        continue;
      }

      const startMinutes = this.timeToMinutes(tier.startTime);
      let endMinutes = this.timeToMinutes(tier.endTime);
      
      if (endMinutes <= startMinutes) {
        endMinutes += this.MINUTES_IN_DAY;
      }
      
      let adjustedCurrent = currentMinutes;
      if (currentMinutes < startMinutes && startMinutes > endMinutes - this.MINUTES_IN_DAY) {
        adjustedCurrent += this.MINUTES_IN_DAY;
      }
      
      if (adjustedCurrent >= startMinutes && adjustedCurrent < endMinutes) {
        return {
          period: tier.period,
          price: tier.price,
          startTime: tier.startTime,
          endTime: tier.endTime,
          tier,
        };
      }
    }

    const defaultTier: PricingTier = {
      id: 'default',
      period: 'flat',
      startTime: '00:00',
      endTime: '24:00',
      price: 0.75,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    };
    return { period: 'flat', price: 0.75, startTime: '00:00', endTime: '24:00', tier: defaultTier };
  }

  static getNextPricing(tiers: PricingTier[], now: Date = new Date()): NextPricingResult {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    const sortedTiers = [...tiers].sort((a, b) => {
      return this.timeToMinutes(a.startTime) - this.timeToMinutes(b.startTime);
    });

    for (const tier of sortedTiers) {
      const startMinutes = this.timeToMinutes(tier.startTime);
      
      if (startMinutes > currentMinutes) {
        return {
          period: tier.period,
          price: tier.price,
          startTime: tier.startTime,
          tier,
        };
      }
    }

    const defaultTier: PricingTier = {
      id: 'default',
      period: 'flat',
      startTime: '00:00',
      endTime: '24:00',
      price: 0.75,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    };
    return {
      period: sortedTiers[0]?.period || 'flat',
      price: sortedTiers[0]?.price || 0.75,
      startTime: sortedTiers[0]?.startTime || '00:00',
      tier: sortedTiers[0] || defaultTier,
    };
  }

  static getPricingAtTime(date: Date, tiers: PricingTier[]): PricingAtTimeResult {
    const minutes = this.timeToMinutes(`${date.getHours()}:${date.getMinutes()}`);
    const currentDayOfWeek = date.getDay();

    for (const tier of tiers) {
      if (tier.daysOfWeek && tier.daysOfWeek.length > 0 && !tier.daysOfWeek.includes(currentDayOfWeek)) {
        continue;
      }

      const startMinutes = this.timeToMinutes(tier.startTime);
      let endMinutes = this.timeToMinutes(tier.endTime);
      
      if (endMinutes <= startMinutes) {
        endMinutes += this.MINUTES_IN_DAY;
      }
      
      let adjustedMinutes = minutes;
      if (minutes < startMinutes && startMinutes > endMinutes - this.MINUTES_IN_DAY) {
        adjustedMinutes += this.MINUTES_IN_DAY;
      }
      
      if (adjustedMinutes >= startMinutes && adjustedMinutes < endMinutes) {
        return { period: tier.period, price: tier.price };
      }
    }

    return { period: 'flat', price: 0.75 };
  }

  static calculateCost(options: CostCalculationOptions): number {
    const { values, tiers } = options;
    let totalCost = 0;

    for (const { value, timestamp } of values) {
      const pricing = this.getPricingAtTime(timestamp, tiers);
      totalCost += value * pricing.price;
    }

    return totalCost;
  }

  static calculateInstantCost(powerKw: number, pricePerKwh: number, durationSeconds: number): number {
    const hours = durationSeconds / 3600;
    return powerKw * hours * pricePerKwh;
  }

  static calculateCostWithBreakdown(options: CostCalculationOptions): DailyCostBreakdown[] {
    const { values, tiers } = options;
    const dailyMap = new Map<string, {
      peakCost: number;
      flatCost: number;
      valleyCost: number;
      peakUsage: number;
      flatUsage: number;
      valleyUsage: number;
    }>();

    for (const { value, timestamp } of values) {
      const dateKey = timestamp.toISOString().split('T')[0];
      const pricing = this.getPricingAtTime(timestamp, tiers);
      
      const current = dailyMap.get(dateKey) || {
        peakCost: 0,
        flatCost: 0,
        valleyCost: 0,
        peakUsage: 0,
        flatUsage: 0,
        valleyUsage: 0,
      };

      const cost = value * pricing.price;
      
      switch (pricing.period) {
        case 'peak':
          current.peakCost += cost;
          current.peakUsage += value;
          break;
        case 'valley':
          current.valleyCost += cost;
          current.valleyUsage += value;
          break;
        default:
          current.flatCost += cost;
          current.flatUsage += value;
      }

      dailyMap.set(dateKey, current);
    }

    return Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        peakCost: Math.round(data.peakCost * 100) / 100,
        flatCost: Math.round(data.flatCost * 100) / 100,
        valleyCost: Math.round(data.valleyCost * 100) / 100,
        totalCost: Math.round((data.peakCost + data.flatCost + data.valleyCost) * 100) / 100,
        peakUsage: Math.round(data.peakUsage * 100) / 100,
        flatUsage: Math.round(data.flatUsage * 100) / 100,
        valleyUsage: Math.round(data.valleyUsage * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  static isPeakHour(tiers: PricingTier[], now: Date = new Date()): boolean {
    return this.getCurrentPricing(tiers, now).period === 'peak';
  }

  static getMinutesUntilNextPeriod(tiers: PricingTier[], now: Date = new Date()): number {
    const next = this.getNextPricing(tiers, now);
    const nextMinutes = this.timeToMinutes(next.startTime);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    if (nextMinutes > currentMinutes) {
      return nextMinutes - currentMinutes;
    }
    return nextMinutes + this.MINUTES_IN_DAY - currentMinutes;
  }

  static getTierByPeriod(tiers: PricingTier[], period: PricingPeriod): PricingTier | undefined {
    return tiers.find(t => t.period === period);
  }

  static getAveragePrice(tiers: PricingTier[]): number {
    const prices = tiers.map(t => t.price);
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  static getPeakPrice(tiers: PricingTier[]): number {
    return Math.max(...tiers.filter(t => t.period === 'peak').map(t => t.price));
  }

  static getValleyPrice(tiers: PricingTier[]): number {
    return Math.min(...tiers.filter(t => t.period === 'valley').map(t => t.price));
  }

  static estimateSavings(
    currentLoadKw: number,
    adjustmentHours: number,
    tiers: PricingTier[],
    baselineTier: PricingPeriod = 'peak',
    targetTier: PricingPeriod = 'valley'
  ): number {
    const baselinePrice = tiers.find(t => t.period === baselineTier)?.price || 0;
    const targetPrice = tiers.find(t => t.period === targetTier)?.price || 0;
    const savingsPerKwh = baselinePrice - targetPrice;
    return Math.round(currentLoadKw * adjustmentHours * savingsPerKwh * 100) / 100;
  }

  static calculateDemandCharge(peakKw: number, demandRate: number): number {
    return Math.round(peakKw * demandRate * 100) / 100;
  }

  static calculatePowerFactorPenalty(powerFactor: number, baseCost: number): number {
    if (powerFactor >= 0.9) return 0;
    const penaltyRate = (0.9 - powerFactor) * 0.1;
    return Math.round(baseCost * penaltyRate * 100) / 100;
  }

  static calculatePowerFactorBonus(powerFactor: number, baseCost: number): number {
    if (powerFactor <= 0.95) return 0;
    const bonusRate = (powerFactor - 0.95) * 0.05;
    return Math.round(baseCost * bonusRate * 100) / 100;
  }

  static validateTiers(tiers: PricingTier[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const timeRanges: { start: number; end: number; id: string }[] = [];

    if (tiers.length === 0) {
      errors.push('至少需要一个电价时段');
      return { valid: false, errors };
    }

    for (const tier of tiers) {
      if (!tier.startTime || !tier.endTime) {
        errors.push(`时段 ${tier.id} 缺少开始或结束时间`);
        continue;
      }

      const start = this.timeToMinutes(tier.startTime);
      let end = this.timeToMinutes(tier.endTime);
      
      if (isNaN(start) || isNaN(end)) {
        errors.push(`时段 ${tier.id} 时间格式错误，应为 HH:MM`);
        continue;
      }

      if (end <= start) {
        end += this.MINUTES_IN_DAY;
      }

      if (end - start < 15) {
        errors.push(`时段 ${tier.id} 时长不足15分钟`);
      }

      for (const existing of timeRanges) {
        if (start < existing.end && end > existing.start) {
          errors.push(`时段 ${tier.id} 与 ${existing.id} 重叠`);
        }
      }

      timeRanges.push({ start, end, id: tier.id });

      if (tier.price <= 0) {
        errors.push(`时段 ${tier.id} 电价必须大于0`);
      }

      if (!['peak', 'flat', 'valley'].includes(tier.period)) {
        errors.push(`时段 ${tier.id} 类型必须是 peak/flat/valley`);
      }
    }

    const totalCoverage = timeRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
    if (totalCoverage < this.MINUTES_IN_DAY) {
      errors.push(`电价时段覆盖不完整，缺少 ${this.MINUTES_IN_DAY - totalCoverage} 分钟`);
    }

    return { valid: errors.length === 0, errors };
  }

  static generateTiersSuggestion(
    peakStartHour: number = 8,
    peakEndHour: number = 21,
    peakPrice: number = 1.25,
    flatPrice: number = 0.75,
    valleyPrice: number = 0.35
  ): PricingTier[] {
    return [
      {
        id: 'peak_1',
        period: 'peak',
        startTime: `${String(peakStartHour).padStart(2, '0')}:00`,
        endTime: '12:00',
        price: peakPrice,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      {
        id: 'peak_2',
        period: 'peak',
        startTime: `${String(peakEndHour - 4).padStart(2, '0')}:00`,
        endTime: `${String(peakEndHour).padStart(2, '0')}:00`,
        price: peakPrice,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      {
        id: 'flat_1',
        period: 'flat',
        startTime: '06:00',
        endTime: `${String(peakStartHour).padStart(2, '0')}:00`,
        price: flatPrice,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      {
        id: 'flat_2',
        period: 'flat',
        startTime: '12:00',
        endTime: `${String(peakEndHour - 4).padStart(2, '0')}:00`,
        price: flatPrice,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      {
        id: 'flat_3',
        period: 'flat',
        startTime: `${String(peakEndHour).padStart(2, '0')}:00`,
        endTime: '23:00',
        price: flatPrice,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
      {
        id: 'valley_1',
        period: 'valley',
        startTime: '23:00',
        endTime: '06:00',
        price: valleyPrice,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
    ];
  }
}

export default PricingEngine;
