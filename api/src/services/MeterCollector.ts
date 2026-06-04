import { EventEmitter } from 'events';
import dataService from './DataService';
import type { EnergyData, MeterPoint } from '../../../shared/types';

export interface CollectorStats {
  totalReceived: number;
  totalStored: number;
  totalErrors: number;
  lastReceivedAt: string | null;
  meterPointCount: number;
  processingLatencyMs: number;
}

export type CollectorEvents = {
  'data:received': (data: EnergyData[]) => void;
  'data:stored': (data: EnergyData[]) => void;
  'data:error': (error: Error, data?: EnergyData[]) => void;
  'data:validated': (data: EnergyData[], invalid: EnergyData[]) => void;
};

export declare interface MeterCollector {
  on<U extends keyof CollectorEvents>(event: U, listener: CollectorEvents[U]): this;
  emit<U extends keyof CollectorEvents>(event: U, ...args: Parameters<CollectorEvents[U]>): boolean;
}

export class MeterCollector extends EventEmitter {
  private meterPoints: MeterPoint[] = [];
  private stats: CollectorStats = {
    totalReceived: 0,
    totalStored: 0,
    totalErrors: 0,
    lastReceivedAt: null,
    meterPointCount: 0,
    processingLatencyMs: 0,
  };

  private validationRules = {
    minValue: 0,
    maxValue: 100000,
    maxTimestampDriftMinutes: 30,
  };

  setMeterPoints(points: MeterPoint[]) {
    this.meterPoints = points;
    this.stats.meterPointCount = points.length;
  }

  async collect(data: EnergyData | EnergyData[]): Promise<{ valid: EnergyData[]; invalid: EnergyData[] }> {
    const startTime = Date.now();
    const dataArray = Array.isArray(data) ? data : [data];
    
    this.stats.totalReceived += dataArray.length;
    this.stats.lastReceivedAt = new Date().toISOString();

    this.emit('data:received', dataArray);

    const { valid, invalid } = this.validateBatch(dataArray);
    
    this.emit('data:validated', valid, invalid);

    if (invalid.length > 0) {
      console.warn(`⚠️  ${invalid.length} data points failed validation`);
    }

    if (valid.length > 0) {
      try {
        await dataService.insertEnergyDataBatch(valid);
        this.stats.totalStored += valid.length;
        this.emit('data:stored', valid);
      } catch (err) {
        this.stats.totalErrors += valid.length;
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('❌ Failed to store energy data:', error.message);
        this.emit('data:error', error, valid);
      }
    }

    this.stats.processingLatencyMs = Date.now() - startTime;
    return { valid, invalid };
  }

  validate(data: EnergyData): EnergyData | null {
    const now = Date.now();

    if (!data.meterPointId || typeof data.meterPointId !== 'string') {
      return null;
    }

    const meterPoint = this.meterPoints.find(mp => mp.id === data.meterPointId);
    if (!meterPoint) {
      return null;
    }

    if (data.value === undefined || data.value === null || isNaN(data.value)) {
      return null;
    }

    if (data.value < this.validationRules.minValue || data.value > this.validationRules.maxValue) {
      return null;
    }

    const timestamp = new Date(data.timestamp).getTime();
    if (isNaN(timestamp)) {
      return null;
    }

    const driftMinutes = Math.abs(now - timestamp) / 60000;
    if (driftMinutes > this.validationRules.maxTimestampDriftMinutes) {
      return null;
    }

    if (data.powerFactor !== undefined) {
      if (data.powerFactor < 0 || data.powerFactor > 1) {
        data.powerFactor = Math.max(0, Math.min(1, data.powerFactor));
      }
    }

    if (data.transformerLoad !== undefined) {
      if (data.transformerLoad < 0 || data.transformerLoad > 2) {
        data.transformerLoad = Math.max(0, Math.min(2, data.transformerLoad));
      }
    }

    return data;
  }

  validateBatch(data: EnergyData[]): { valid: EnergyData[]; invalid: EnergyData[] } {
    const valid: EnergyData[] = [];
    const invalid: EnergyData[] = [];

    for (const item of data) {
      const validated = this.validate(item);
      if (validated) {
        valid.push(validated);
      } else {
        invalid.push(item);
      }
    }

    return { valid, invalid };
  }

  getStats(): CollectorStats {
    return { ...this.stats };
  }

  resetStats() {
    this.stats = {
      totalReceived: 0,
      totalStored: 0,
      totalErrors: 0,
      lastReceivedAt: null,
      meterPointCount: this.meterPoints.length,
      processingLatencyMs: 0,
    };
  }

  getMeterPoint(id: string): MeterPoint | undefined {
    return this.meterPoints.find(mp => mp.id === id);
  }

  getMeterPointsByType(type: MeterPoint['type']): MeterPoint[] {
    return this.meterPoints.filter(mp => mp.type === type);
  }

  getMeterPointsByFloor(floor: number): MeterPoint[] {
    return this.meterPoints.filter(mp => mp.floor === floor);
  }
}

export default new MeterCollector();
