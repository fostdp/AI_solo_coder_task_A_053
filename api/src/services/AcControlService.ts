import pool from '../config/database';
import pricingService from './PricingService';
import LoadController from './LoadController';
import type { ACControlStrategy, ACStatus, PricingTier, PricingPeriod } from '../../../shared/types';
import type { EnvironmentData, LoadForecast, ControlStrategy } from './LoadController';

export class ACControlService {
  private latestEnvData: Map<string, EnvironmentData> = new Map();

  setEnvironmentData(envData: Map<string, EnvironmentData>) {
    this.latestEnvData = envData;
  }

  getEnvironmentData(): Map<string, EnvironmentData> {
    return this.latestEnvData;
  }

  private getAverageEnvironment(): EnvironmentData {
    return LoadController.getAverageEnvironment(this.latestEnvData);
  }

  async getStrategy(): Promise<ACControlStrategy> {
    try {
      const result = await pool.query(
        `SELECT id, enabled, peak_temp_adjustment as "peakTempAdjustment",
                normal_set_point as "normalSetPoint", min_set_point as "minSetPoint",
                max_set_point as "maxSetPoint", co2_threshold as "co2Threshold",
                occupancy_threshold as "occupancyThreshold", temp_limit_high as "tempLimitHigh",
                co2_constraint_enabled as "co2ConstraintEnabled",
                occupancy_constraint_enabled as "occupancyConstraintEnabled",
                created_at as "createdAt", updated_at as "updatedAt"
         FROM ac_control_strategy ORDER BY id DESC LIMIT 1`
      );

      if (result.rows.length === 0) {
        return {
          id: 1,
          enabled: true,
          baseTemperature: 24.0,
          peakAdjustment: 2.0,
          flatAdjustment: 1.0,
          peakTempAdjustment: 2.0,
          normalSetPoint: 24.0,
          minSetPoint: 20.0,
          maxSetPoint: 28.0,
          co2Threshold: 1000,
          occupancyThreshold: 80,
          tempLimitHigh: 26.0,
          co2ConstraintEnabled: true,
          occupancyConstraintEnabled: true,
        };
      }

      const row = result.rows[0];
      return {
        ...row,
        baseTemperature: row.normalSetPoint || 24.0,
        peakAdjustment: row.peakTempAdjustment || 2.0,
        flatAdjustment: row.flatAdjustment || 1.0,
        co2Threshold: row.co2Threshold ?? 1000,
        occupancyThreshold: row.occupancyThreshold ?? 80,
        tempLimitHigh: row.tempLimitHigh ?? 26.0,
        co2ConstraintEnabled: row.co2ConstraintEnabled ?? true,
        occupancyConstraintEnabled: row.occupancyConstraintEnabled ?? true,
      };
    } catch (err) {
      return {
        id: 1,
        enabled: true,
        baseTemperature: 24.0,
        peakAdjustment: 2.0,
        flatAdjustment: 1.0,
        peakTempAdjustment: 2.0,
        normalSetPoint: 24.0,
        minSetPoint: 20.0,
        maxSetPoint: 28.0,
        co2Threshold: 1000,
        occupancyThreshold: 80,
        tempLimitHigh: 26.0,
        co2ConstraintEnabled: true,
        occupancyConstraintEnabled: true,
      };
    }
  }

  async updateStrategy(strategy: ACControlStrategy): Promise<ACControlStrategy> {
    const validation = LoadController.validateStrategy(strategy);
    if (!validation.valid) {
      throw new Error(`控制策略验证失败: ${validation.errors.join(', ')}`);
    }

    const peakAdj = strategy.peakAdjustment ?? strategy.peakTempAdjustment ?? 2.0;
    const baseTemp = strategy.baseTemperature ?? strategy.normalSetPoint ?? 24.0;
    const flatAdj = strategy.flatAdjustment ?? 1.0;

    try {
      const result = await pool.query(
        `INSERT INTO ac_control_strategy (enabled, peak_temp_adjustment, normal_set_point, min_set_point, 
                                          max_set_point, co2_threshold, occupancy_threshold, temp_limit_high,
                                          co2_constraint_enabled, occupancy_constraint_enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           peak_temp_adjustment = EXCLUDED.peak_temp_adjustment,
           normal_set_point = EXCLUDED.normal_set_point,
           min_set_point = EXCLUDED.min_set_point,
           max_set_point = EXCLUDED.max_set_point,
           co2_threshold = EXCLUDED.co2_threshold,
           occupancy_threshold = EXCLUDED.occupancy_threshold,
           temp_limit_high = EXCLUDED.temp_limit_high,
           co2_constraint_enabled = EXCLUDED.co2_constraint_enabled,
           occupancy_constraint_enabled = EXCLUDED.occupancy_constraint_enabled,
           updated_at = NOW()
         RETURNING id, enabled, peak_temp_adjustment as "peakTempAdjustment",
                   normal_set_point as "normalSetPoint", min_set_point as "minSetPoint",
                   max_set_point as "maxSetPoint", co2_threshold as "co2Threshold",
                   occupancy_threshold as "occupancyThreshold", temp_limit_high as "tempLimitHigh",
                   co2_constraint_enabled as "co2ConstraintEnabled",
                   occupancy_constraint_enabled as "occupancyConstraintEnabled",
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [
          strategy.enabled,
          peakAdj,
          baseTemp,
          strategy.minSetPoint ?? 20.0,
          strategy.maxSetPoint ?? 28.0,
          strategy.co2Threshold ?? 1000,
          strategy.occupancyThreshold ?? 80,
          strategy.tempLimitHigh ?? 26.0,
          strategy.co2ConstraintEnabled ?? true,
          strategy.occupancyConstraintEnabled ?? true,
        ]
      );

      const row = result.rows[0];
      return {
        ...row,
        baseTemperature: baseTemp,
        peakAdjustment: peakAdj,
        flatAdjustment: flatAdj,
      };
    } catch (err) {
      return {
        id: 1,
        ...strategy,
        baseTemperature: baseTemp,
        peakAdjustment: peakAdj,
        flatAdjustment: flatAdj,
        peakTempAdjustment: peakAdj,
        normalSetPoint: baseTemp,
        minSetPoint: strategy.minSetPoint ?? 20.0,
        maxSetPoint: strategy.maxSetPoint ?? 28.0,
        co2Threshold: strategy.co2Threshold ?? 1000,
        occupancyThreshold: strategy.occupancyThreshold ?? 80,
        tempLimitHigh: strategy.tempLimitHigh ?? 26.0,
        co2ConstraintEnabled: strategy.co2ConstraintEnabled ?? true,
        occupancyConstraintEnabled: strategy.occupancyConstraintEnabled ?? true,
      };
    }
  }

  async getStatus(tiers?: PricingTier[]): Promise<ACStatus> {
    const strategy = await this.getStrategy();
    const pricingTiers = tiers || await pricingService.getPricingTiers();
    const envData = this.getAverageEnvironment();

    const getCurrentPricing = (t: PricingTier[]) => {
      const result = pricingService.getCurrentPricing(t);
      return {
        period: result.period as PricingPeriod,
        startTime: result.startTime,
        endTime: result.endTime,
        price: result.price,
      };
    };

    const decision = LoadController.makeControlDecision(
      strategy,
      pricingTiers,
      envData,
      getCurrentPricing
    );

    return {
      currentSetPoint: decision.currentSetPoint,
      isPeakMode: decision.isPeakMode,
      adjustmentApplied: decision.adjustmentApplied,
      strategy,
      currentTemp: decision.indoorTemp,
      baseTemp: decision.baseTemp,
      adjustment: decision.adjustmentApplied,
      isAdjusted: decision.isAdjusted,
      currentPeriod: decision.currentPeriod,
      co2Level: decision.co2Level,
      occupancyCount: decision.occupancyCount,
      indoorTemp: decision.indoorTemp,
      co2Constrained: decision.co2Constrained,
      occupancyConstrained: decision.occupancyConstrained,
      adjustmentReduced: decision.adjustmentReduced,
      constraintReason: decision.constraintReason,
    };
  }

  async getAdjustmentRecommendation() {
    const strategy = await this.getStrategy();
    const tiers = await pricingService.getPricingTiers();
    const envData = this.getAverageEnvironment();

    const getCurrentPricing = (t: PricingTier[]) => {
      const result = pricingService.getCurrentPricing(t);
      return {
        period: result.period as PricingPeriod,
        startTime: result.startTime,
        endTime: result.endTime,
        price: result.price,
      };
    };

    const getNextPricing = (t: PricingTier[]) => {
      const result = pricingService.getNextPricing(t);
      return {
        period: result.period as PricingPeriod,
        startTime: result.startTime,
        price: result.price,
      };
    };

    const decision = LoadController.makeControlDecision(
      strategy,
      tiers,
      envData,
      getCurrentPricing
    );

    return LoadController.makeSchedulingDecision(
      decision,
      strategy,
      tiers,
      getCurrentPricing,
      getNextPricing
    );
  }

  async getEnergySavingsReport() {
    const strategy = await this.getStrategy();
    return LoadController.estimateEnergySavings(strategy);
  }

  async getLoadForecast(
    baseLoadKw: number = 200,
    controlStrategy: ControlStrategy = 'balanced'
  ): Promise<LoadForecast[]> {
    const tiers = await pricingService.getPricingTiers();
    
    const getPricingAtTime = (hour: number, t: PricingTier[]): PricingPeriod => {
      const date = new Date();
      date.setHours(hour, 0, 0, 0);
      const result = pricingService.getCurrentPricing(t, date);
      return result.period as PricingPeriod;
    };

    return LoadController.forecastLoad(tiers, baseLoadKw, getPricingAtTime, controlStrategy);
  }

  async getLoadReductionPotential(currentLoadKw: number) {
    const strategy = await this.getStrategy();
    const tiers = await pricingService.getPricingTiers();
    const envData = this.getAverageEnvironment();

    return LoadController.calculateLoadReductionPotential(
      currentLoadKw,
      tiers,
      strategy,
      envData
    );
  }

  async getOptimizedSchedule(
    targetSavingsPercent: number = 15,
    maxComfortImpact: 'low' | 'medium' | 'high' = 'medium'
  ) {
    const tiers = await pricingService.getPricingTiers();
    return LoadController.getOptimizedSchedule(tiers, targetSavingsPercent, maxComfortImpact);
  }

  async validateStrategy(strategy: ACControlStrategy) {
    return LoadController.validateStrategy(strategy);
  }
}

export default new ACControlService();
