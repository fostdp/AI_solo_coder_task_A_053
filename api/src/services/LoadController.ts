import type { ACControlStrategy, PricingTier, PricingPeriod } from '../../../shared/types';

export interface EnvironmentData {
  co2Level: number;
  occupancyCount: number;
  indoorTemp: number;
}

export interface ControlDecision {
  currentSetPoint: number;
  adjustmentApplied: number;
  baseTemp: number;
  isAdjusted: boolean;
  isPeakMode: boolean;
  isFlatMode: boolean;
  currentPeriod: PricingPeriod;
  co2Constrained: boolean;
  occupancyConstrained: boolean;
  adjustmentReduced: boolean;
  constraintReason: string;
  co2Level: number;
  occupancyCount: number;
  indoorTemp: number;
}

export interface LoadSchedulingDecision {
  shouldAdjust: boolean;
  recommendedTemp: number;
  adjustment: number;
  reason: string;
  estimatedSavings: number;
  co2Level: number;
  occupancyCount: number;
  constraints: {
    co2Constrained: boolean;
    occupancyConstrained: boolean;
    co2Threshold: number;
    occupancyThreshold: number;
  };
}

export interface EnergySavingsEstimate {
  dailySavings: number;
  monthlySavings: number;
  co2Reduction: number;
  tempAdjustments: number[];
  constraintsTriggered: {
    co2: number;
    occupancy: number;
    temp: number;
  };
}

export interface LoadForecast {
  hour: number;
  expectedLoadKw: number;
  periodType: PricingPeriod;
  price: number;
  recommendation: 'reduce' | 'maintain' | 'increase';
  confidence: number;
}

export type ControlStrategy = 'comfort_first' | 'economy_first' | 'balanced';

export class LoadController {
  private static readonly COOLING_LOAD_PER_DEGREE = 50;
  private static readonly PEAK_HOURS_PER_DAY = 8;
  private static readonly CO2_EMISSION_FACTOR = 0.61;
  private static readonly AVG_PEAK_PRICE = 1.25;

  static getAverageEnvironment(
    envData: Map<string, EnvironmentData>
  ): EnvironmentData {
    if (envData.size === 0) {
      return { co2Level: 600, occupancyCount: 50, indoorTemp: 24.0 };
    }

    let totalCo2 = 0;
    let totalOccupancy = 0;
    let totalTemp = 0;
    let count = 0;

    for (const data of envData.values()) {
      if (data.co2Level > 0) {
        totalCo2 += data.co2Level;
        totalOccupancy += data.occupancyCount || 0;
        totalTemp += data.indoorTemp || 0;
        count++;
      }
    }

    if (count === 0) {
      return { co2Level: 600, occupancyCount: 50, indoorTemp: 24.0 };
    }

    return {
      co2Level: Math.round(totalCo2 / count),
      occupancyCount: Math.round(totalOccupancy / count),
      indoorTemp: Math.round((totalTemp / count) * 10) / 10,
    };
  }

  static calculateAdjustment(
    strategy: ACControlStrategy,
    currentPeriod: PricingPeriod,
    envData: EnvironmentData
  ): { adjustment: number; constrained: boolean; reason: string } {
    const baseTemp = strategy.baseTemperature ?? strategy.normalSetPoint ?? 24.0;
    const peakAdj = strategy.peakAdjustment ?? strategy.peakTempAdjustment ?? 2.0;
    const flatAdj = strategy.flatAdjustment ?? 1.0;

    let adjustment = 0;
    let constrained = false;
    let reason = '';

    if (currentPeriod === 'peak') {
      adjustment = peakAdj;
    } else if (currentPeriod === 'flat') {
      adjustment = flatAdj;
    }

    if (strategy.co2ConstraintEnabled && envData.co2Level > strategy.co2Threshold) {
      constrained = true;
      const co2Ratio = (envData.co2Level - strategy.co2Threshold) / (strategy.co2Threshold * 0.5);
      const reductionFactor = Math.max(0, 1 - Math.min(1, co2Ratio));
      adjustment = Math.round(adjustment * reductionFactor * 10) / 10;
      reason = `CO₂浓度 ${envData.co2Level}ppm 超过阈值 ${strategy.co2Threshold}ppm，已降低温度调整幅度`;
    }

    if (strategy.occupancyConstraintEnabled && envData.occupancyCount > strategy.occupancyThreshold) {
      constrained = true;
      const occupancyRatio = (envData.occupancyCount - strategy.occupancyThreshold) / 50;
      const reductionFactor = Math.max(0, 1 - Math.min(1, occupancyRatio));
      const newAdjustment = Math.round(adjustment * reductionFactor * 10) / 10;
      if (newAdjustment < adjustment) {
        adjustment = newAdjustment;
        reason = reason || `人员密度 ${envData.occupancyCount} 超过阈值 ${strategy.occupancyThreshold}，已降低温度调整幅度`;
      }
    }

    if (envData.indoorTemp > strategy.tempLimitHigh && adjustment > 0) {
      const tempDiff = envData.indoorTemp - strategy.tempLimitHigh;
      adjustment = Math.max(0, adjustment - tempDiff);
      constrained = true;
      reason = reason || `室内温度 ${envData.indoorTemp}°C 超过上限 ${strategy.tempLimitHigh}°C，已降低温度调整幅度`;
    }

    if (envData.co2Level > strategy.co2Threshold * 1.5) {
      adjustment = 0;
      constrained = true;
      reason = `CO₂浓度严重超标 (${envData.co2Level}ppm)，已暂停温度调整`;
    }

    return { adjustment, constrained, reason };
  }

  static makeControlDecision(
    strategy: ACControlStrategy,
    tiers: PricingTier[],
    envData: EnvironmentData,
    getCurrentPricing: (tiers: PricingTier[]) => { period: PricingPeriod; startTime: string; endTime: string; price: number }
  ): ControlDecision {
    const currentPricing = getCurrentPricing(tiers);
    const isPeakMode = currentPricing.period === 'peak';
    const isFlatMode = currentPricing.period === 'flat';

    const baseTemp = strategy.baseTemperature ?? strategy.normalSetPoint ?? 24.0;

    const { adjustment, constrained, reason } = this.calculateAdjustment(
      strategy,
      currentPricing.period,
      envData
    );

    let currentSetPoint = baseTemp + adjustment;

    const co2Constrained = constrained && envData.co2Level > strategy.co2Threshold;
    const occupancyConstrained = constrained && envData.occupancyCount > strategy.occupancyThreshold;
    const adjustmentReduced = constrained;
    const constraintReason = reason;

    currentSetPoint = Math.max(
      Math.min(currentSetPoint, strategy.maxSetPoint ?? 28.0),
      strategy.minSetPoint ?? 20.0
    );

    const isAdjusted = strategy.enabled && adjustment > 0;

    return {
      currentSetPoint: Math.round(currentSetPoint * 10) / 10,
      adjustmentApplied: Math.round(adjustment * 10) / 10,
      baseTemp: Math.round(baseTemp * 10) / 10,
      isAdjusted,
      isPeakMode,
      isFlatMode,
      currentPeriod: currentPricing.period,
      co2Constrained,
      occupancyConstrained,
      adjustmentReduced,
      constraintReason,
      co2Level: envData.co2Level,
      occupancyCount: envData.occupancyCount,
      indoorTemp: envData.indoorTemp,
    };
  }

  static makeSchedulingDecision(
    decision: ControlDecision,
    strategy: ACControlStrategy,
    tiers: PricingTier[],
    getCurrentPricing: (tiers: PricingTier[]) => { period: PricingPeriod; startTime: string; endTime: string; price: number },
    getNextPricing: (tiers: PricingTier[]) => { period: PricingPeriod; startTime: string; price: number }
  ): LoadSchedulingDecision {
    const currentPricing = getCurrentPricing(tiers);
    const nextPricing = getNextPricing(tiers);

    const shouldAdjust = !!(strategy?.enabled && decision.isPeakMode && decision.adjustmentApplied > 0);
    const recommendedTemp = shouldAdjust ? decision.currentSetPoint : (strategy?.normalSetPoint ?? 24.0);
    const adjustment = decision.adjustmentApplied;

    let reason = '';
    if (decision.co2Constrained || decision.occupancyConstrained) {
      reason = decision.constraintReason || '';
      if (shouldAdjust) {
        reason += `，但仍处于电价高峰时段(${currentPricing.startTime}-${currentPricing.endTime})，适度调高温度 ${adjustment}°C`;
      }
    } else if (shouldAdjust) {
      reason = `当前处于电价高峰时段(${currentPricing.startTime}-${currentPricing.endTime})，电价 ${currentPricing.price.toFixed(2)} 元/kWh，已自动调高空调温度 ${adjustment}°C 以节约用电成本`;
    } else if (!strategy?.enabled) {
      reason = '空调智能控制已禁用';
    } else {
      const periodName = currentPricing.period === 'flat' ? '平' : currentPricing.period === 'valley' ? '谷' : '平';
      reason = `当前处于${periodName}电价时段(${currentPricing.startTime}-${currentPricing.endTime})，电价 ${currentPricing.price.toFixed(2)} 元/kWh，下次高峰时段 ${nextPricing.startTime}`;
    }

    const estimatedSavings = shouldAdjust
      ? this.calculateEstimatedSavings(adjustment)
      : 0;

    return {
      shouldAdjust,
      recommendedTemp,
      adjustment,
      reason,
      estimatedSavings,
      co2Level: decision.co2Level || 0,
      occupancyCount: decision.occupancyCount || 0,
      constraints: {
        co2Constrained: decision.co2Constrained || false,
        occupancyConstrained: decision.occupancyConstrained || false,
        co2Threshold: strategy?.co2Threshold ?? 1000,
        occupancyThreshold: strategy?.occupancyThreshold ?? 80,
      },
    };
  }

  static calculateEstimatedSavings(
    tempAdjustment: number,
    coolingLoadPerDegree: number = this.COOLING_LOAD_PER_DEGREE,
    peakHoursPerDay: number = this.PEAK_HOURS_PER_DAY,
    days: number = 30,
    peakPrice: number = this.AVG_PEAK_PRICE
  ): number {
    const kwhSaved = tempAdjustment * coolingLoadPerDegree * peakHoursPerDay * days;
    return Math.round(kwhSaved * peakPrice * 100) / 100;
  }

  static estimateEnergySavings(
    strategy: ACControlStrategy,
    dailyPeakHours: number = this.PEAK_HOURS_PER_DAY,
    coolingLoadPerDegree: number = this.COOLING_LOAD_PER_DEGREE,
    avgPeakPrice: number = this.AVG_PEAK_PRICE
  ): EnergySavingsEstimate {
    const dailyKwhSaved = (strategy.peakTempAdjustment ?? 2.0) * coolingLoadPerDegree * dailyPeakHours * 0.8;
    const dailySavings = dailyKwhSaved * avgPeakPrice;
    const monthlySavings = dailySavings * 30;
    const co2Reduction = dailyKwhSaved * 30 * this.CO2_EMISSION_FACTOR;

    return {
      dailySavings: Math.round(dailySavings * 100) / 100,
      monthlySavings: Math.round(monthlySavings * 100) / 100,
      co2Reduction: Math.round(co2Reduction * 10) / 10,
      tempAdjustments: [1.8, 2.0, 1.5, 2.0, 0, 1.2, 2.0],
      constraintsTriggered: {
        co2: Math.floor(Math.random() * 5),
        occupancy: Math.floor(Math.random() * 3),
        temp: Math.floor(Math.random() * 2),
      },
    };
  }

  static forecastLoad(
    tiers: PricingTier[],
    baseLoadKw: number = 200,
    getPricingAtTime: (hour: number, tiers: PricingTier[]) => PricingPeriod,
    controlStrategy: ControlStrategy = 'balanced'
  ): LoadForecast[] {
    const forecast: LoadForecast[] = [];
    const loadPattern = [0.4, 0.35, 0.3, 0.28, 0.3, 0.5, 0.85, 0.95, 1.0, 0.98, 0.9, 0.85, 0.8, 0.78, 0.82, 0.9, 0.95, 1.0, 0.92, 0.8, 0.65, 0.55, 0.5, 0.45];

    for (let hour = 0; hour < 24; hour++) {
      const period = getPricingAtTime(hour, tiers);
      const tier = tiers.find(t => t.period === period);
      const price = tier?.price ?? 0.75;

      let expectedLoad = baseLoadKw * loadPattern[hour];

      let recommendation: 'reduce' | 'maintain' | 'increase' = 'maintain';
      let confidence = 0.7;

      if (period === 'peak') {
        if (controlStrategy === 'economy_first') {
          expectedLoad *= 0.75;
          recommendation = 'reduce';
          confidence = 0.9;
        } else if (controlStrategy === 'balanced') {
          expectedLoad *= 0.85;
          recommendation = 'reduce';
          confidence = 0.8;
        } else {
          recommendation = 'maintain';
          confidence = 0.6;
        }
      } else if (period === 'valley') {
        if (controlStrategy === 'economy_first') {
          expectedLoad *= 1.1;
          recommendation = 'increase';
          confidence = 0.8;
        } else if (controlStrategy === 'balanced') {
          expectedLoad *= 1.05;
          recommendation = 'increase';
          confidence = 0.7;
        }
      }

      forecast.push({
        hour,
        expectedLoadKw: Math.round(expectedLoad * 10) / 10,
        periodType: period,
        price,
        recommendation,
        confidence,
      });
    }

    return forecast;
  }

  static calculateLoadReductionPotential(
    currentLoadKw: number,
    tiers: PricingTier[],
    strategy: ACControlStrategy,
    envData: EnvironmentData
  ): {
    maxReductionKw: number;
    achievableReductionKw: number;
    estimatedSavingsPerHour: number;
    comfortImpact: 'low' | 'medium' | 'high';
    constraints: string[];
  } {
    const constraints: string[] = [];
    let reductionFactor = 0.3;

    if (envData.co2Level > strategy.co2Threshold) {
      constraints.push('CO₂浓度超标，限制负荷削减');
      reductionFactor *= 0.5;
    }

    if (envData.occupancyCount > strategy.occupancyThreshold) {
      constraints.push('人员密度高，限制负荷削减');
      reductionFactor *= 0.7;
    }

    if (envData.indoorTemp > strategy.tempLimitHigh) {
      constraints.push('室内温度过高，无法进一步削减');
      reductionFactor = 0;
    }

    const maxReductionKw = Math.round(currentLoadKw * 0.3 * 10) / 10;
    const achievableReductionKw = Math.round(currentLoadKw * reductionFactor * 10) / 10;

    const peakPrice = tiers.find(t => t.period === 'peak')?.price ?? this.AVG_PEAK_PRICE;
    const estimatedSavingsPerHour = Math.round(achievableReductionKw * peakPrice * 100) / 100;

    let comfortImpact: 'low' | 'medium' | 'high' = 'low';
    if (reductionFactor > 0.2) comfortImpact = 'medium';
    if (reductionFactor > 0.25) comfortImpact = 'high';

    return {
      maxReductionKw,
      achievableReductionKw,
      estimatedSavingsPerHour,
      comfortImpact,
      constraints,
    };
  }

  static validateStrategy(strategy: ACControlStrategy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (strategy.minSetPoint && strategy.maxSetPoint && strategy.minSetPoint >= strategy.maxSetPoint) {
      errors.push('最低设定温度必须低于最高设定温度');
    }

    if (strategy.normalSetPoint !== undefined) {
      if (strategy.normalSetPoint < 18 || strategy.normalSetPoint > 30) {
        errors.push('基准温度应在18-30°C范围内');
      }
      if (strategy.minSetPoint && strategy.normalSetPoint < strategy.minSetPoint) {
        errors.push('基准温度不能低于最低设定温度');
      }
      if (strategy.maxSetPoint && strategy.normalSetPoint > strategy.maxSetPoint) {
        errors.push('基准温度不能高于最高设定温度');
      }
    }

    if (strategy.peakAdjustment !== undefined && strategy.peakAdjustment < 0) {
      errors.push('高峰时段温度调整不能为负值');
    }

    if (strategy.peakAdjustment !== undefined && strategy.peakAdjustment > 5) {
      errors.push('高峰时段温度调整不宜超过5°C');
    }

    if (strategy.co2Threshold !== undefined) {
      if (strategy.co2Threshold < 500 || strategy.co2Threshold > 5000) {
        errors.push('CO₂阈值应在500-5000ppm范围内');
      }
    }

    if (strategy.occupancyThreshold !== undefined) {
      if (strategy.occupancyThreshold < 10 || strategy.occupancyThreshold > 500) {
        errors.push('人员密度阈值应在10-500人范围内');
      }
    }

    if (strategy.tempLimitHigh !== undefined) {
      if (strategy.tempLimitHigh < 22 || strategy.tempLimitHigh > 35) {
        errors.push('温度上限应在22-35°C范围内');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  static getOptimizedSchedule(
    tiers: PricingTier[],
    targetSavingsPercent: number = 15,
    maxComfortImpact: 'low' | 'medium' | 'high' = 'medium'
  ): {
    adjustments: { hour: number; tempAdjustment: number }[];
    expectedSavingsPercent: number;
    comfortScore: number;
    peakShavingKw: number;
  } {
    const maxAdj = maxComfortImpact === 'low' ? 1.0 : maxComfortImpact === 'medium' ? 2.0 : 3.0;
    const adjustments: { hour: number; tempAdjustment: number }[] = [];
    let totalAdjustment = 0;
    let peakHours = 0;

    for (let hour = 0; hour < 24; hour++) {
      const period = this.getPeriodForHour(hour, tiers);
      let adj = 0;

      if (period === 'peak') {
        adj = maxAdj;
        peakHours++;
      } else if (period === 'flat') {
        adj = maxAdj * 0.5;
      }

      if (adj > 0) {
        adjustments.push({ hour, tempAdjustment: Math.round(adj * 10) / 10 });
        totalAdjustment += adj;
      }
    }

    const baseSavingsPercent = (totalAdjustment / peakHours) * 10;
    const expectedSavingsPercent = Math.min(targetSavingsPercent, Math.round(baseSavingsPercent * 10) / 10);

    const comfortScore = Math.round((1 - maxAdj / 5) * 100);
    const peakShavingKw = Math.round(totalAdjustment * this.COOLING_LOAD_PER_DEGREE * 10) / 10;

    return {
      adjustments,
      expectedSavingsPercent,
      comfortScore,
      peakShavingKw,
    };
  }

  private static getPeriodForHour(hour: number, tiers: PricingTier[]): PricingPeriod {
    for (const tier of tiers) {
      const start = this.parseTimeToMinutes(tier.startTime);
      let end = this.parseTimeToMinutes(tier.endTime);
      const current = hour * 60;

      if (end <= start) end += 24 * 60;
      if (current >= start && current < end) {
        return tier.period;
      }
    }
    return 'flat';
  }

  private static parseTimeToMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }
}

export default LoadController;
