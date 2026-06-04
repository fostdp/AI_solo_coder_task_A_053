import pool from '../config/database';
import PricingEngine from './PricingEngine';
import type { PricingTier, CurrentPricing, PricingPeriod } from '../../../shared/types';
import type { CostCalculationOptions, DailyCostBreakdown, CurrentPricingResult, NextPricingResult } from './PricingEngine';

export class PricingService {
  getCurrentPricing(tiers: PricingTier[], now: Date = new Date()): CurrentPricingResult {
    return PricingEngine.getCurrentPricing(tiers, now);
  }

  getNextPricing(tiers: PricingTier[], now: Date = new Date()): NextPricingResult {
    return PricingEngine.getNextPricing(tiers, now);
  }

  async getPricingTiers(): Promise<PricingTier[]> {
    const result = await pool.query(
      `SELECT id, period, start_time as "startTime", end_time as "endTime", 
              price, days_of_week as "daysOfWeek", created_at as "createdAt", updated_at as "updatedAt"
       FROM pricing_tiers ORDER BY start_time`
    );
    return result.rows.map((row: any) => ({
      ...row,
      daysOfWeek: row.daysOfWeek || [1, 2, 3, 4, 5],
    }));
  }

  async updatePricingTiers(tiers: PricingTier[]): Promise<void> {
    const validation = PricingEngine.validateTiers(tiers);
    if (!validation.valid) {
      throw new Error(`电价配置验证失败: ${validation.errors.join(', ')}`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM pricing_tiers');
      
      for (const tier of tiers) {
        await client.query(
          `INSERT INTO pricing_tiers (id, period, start_time, end_time, price, days_of_week, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET 
             period = EXCLUDED.period,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             price = EXCLUDED.price,
             days_of_week = EXCLUDED.days_of_week,
             updated_at = NOW()`,
          [tier.id, tier.period, tier.startTime, tier.endTime, tier.price, tier.daysOfWeek || [1, 2, 3, 4, 5]]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCurrentPricingInfo(): Promise<CurrentPricing> {
    const tiers = await this.getPricingTiers();
    const now = new Date();
    const current = PricingEngine.getCurrentPricing(tiers, now);
    const next = PricingEngine.getNextPricing(tiers, now);

    const todayCost = await this.calculateCostForPeriod(24);
    const monthCost = await this.calculateCostForPeriod(24 * 30);

    return {
      ...current,
      nextPeriod: next.period,
      nextPrice: next.price,
      nextStartTime: next.startTime,
      todayCost,
      monthCost,
      currentTier: current.tier,
      nextTier: next.tier,
      dailyCost: todayCost,
    };
  }

  async calculateCostForPeriod(hours: number): Promise<number> {
    const tiers = await this.getPricingTiers();
    
    const result = await pool.query(
      `SELECT ed.timestamp, ed.value, mp.type
       FROM energy_data ed
       JOIN meter_points mp ON ed.meter_point_id = mp.id
       WHERE mp.type = 'electricity' 
         AND ed.timestamp >= NOW() - $1 * INTERVAL '1 hour'
       ORDER BY ed.timestamp`,
      [hours]
    );

    const values = result.rows.map((row: any) => ({
      value: parseFloat(row.value),
      timestamp: new Date(row.timestamp),
    }));

    const options: CostCalculationOptions = { values, tiers };
    return PricingEngine.calculateCost(options);
  }

  async getCostBreakdown(days: number = 7): Promise<DailyCostBreakdown[]> {
    const tiers = await this.getPricingTiers();
    
    const result = await pool.query(
      `SELECT ed.timestamp, ed.value, mp.type
       FROM energy_data ed
       JOIN meter_points mp ON ed.meter_point_id = mp.id
       WHERE mp.type = 'electricity' 
         AND ed.timestamp >= NOW() - $1 * INTERVAL '1 day'
       ORDER BY ed.timestamp`,
      [days]
    );

    const values = result.rows.map((row: any) => ({
      value: parseFloat(row.value),
      timestamp: new Date(row.timestamp),
    }));

    const options: CostCalculationOptions = { values, tiers };
    return PricingEngine.calculateCostWithBreakdown(options);
  }

  calculateInstantCost(powerKw: number, pricePerKwh: number, durationSeconds: number): number {
    return PricingEngine.calculateInstantCost(powerKw, pricePerKwh, durationSeconds);
  }

  async isPeakHour(now: Date = new Date()): Promise<boolean> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.isPeakHour(tiers, now);
  }

  async getMinutesUntilNextPeriod(now: Date = new Date()): Promise<number> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.getMinutesUntilNextPeriod(tiers, now);
  }

  async getAveragePrice(): Promise<number> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.getAveragePrice(tiers);
  }

  async getPeakPrice(): Promise<number> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.getPeakPrice(tiers);
  }

  async getValleyPrice(): Promise<number> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.getValleyPrice(tiers);
  }

  async estimateSavings(
    currentLoadKw: number,
    adjustmentHours: number,
    baselineTier = 'peak' as const,
    targetTier = 'valley' as const
  ): Promise<number> {
    const tiers = await this.getPricingTiers();
    return PricingEngine.estimateSavings(currentLoadKw, adjustmentHours, tiers, baselineTier, targetTier);
  }

  async getSuggestedTiers(
    peakStartHour: number = 8,
    peakEndHour: number = 21,
    peakPrice: number = 1.25,
    flatPrice: number = 0.75,
    valleyPrice: number = 0.35
  ): Promise<PricingTier[]> {
    return PricingEngine.generateTiersSuggestion(peakStartHour, peakEndHour, peakPrice, flatPrice, valleyPrice);
  }

  async validateTiers(tiers: PricingTier[]): Promise<{ valid: boolean; errors: string[] }> {
    return PricingEngine.validateTiers(tiers);
  }
}

export default new PricingService();
