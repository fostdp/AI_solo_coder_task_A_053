import { EventEmitter } from 'events';
import pool from '../config/database';
import type { EnergyData, MeterPoint, Alert, AlertType, AlertSeverity } from '../../../shared/types';

export const ABNORMAL_THRESHOLD_MULTIPLIER = 3;
export const ABNORMAL_DURATION_MINUTES = 5;
export const POWER_FACTOR_THRESHOLD = 0.85;
export const TRANSFORMER_LOAD_THRESHOLD = 0.90;

export function getEnergyStatus(value: number, historicalAverage: number): { status: string; ratio: number } {
  const ratio = value / historicalAverage;
  if (ratio < 0.8) return { status: 'low', ratio };
  if (ratio <= 1.2) return { status: 'normal', ratio };
  if (ratio <= 2.0) return { status: 'warning', ratio };
  return { status: 'alert', ratio };
}

export interface AlarmEngineStats {
  totalAlerts: number;
  activeAlerts: number;
  abnormalMonitoring: number;
  powerFactorAlerts: number;
  transformerAlerts: number;
  lastAlertAt: string | null;
}

export type AlarmEngineEvents = {
  'alert:fired': (alert: Alert) => void;
  'alert:resolved': (alert: Alert) => void;
  'monitoring:start': (meterPointId: string, value: number) => void;
  'monitoring:end': (meterPointId: string, resolved: boolean) => void;
};

interface MonitoringState {
  startTime: Date;
  value: number;
  count: number;
}

export declare interface EnergyAlarmEngine {
  on<U extends keyof AlarmEngineEvents>(event: U, listener: AlarmEngineEvents[U]): this;
  emit<U extends keyof AlarmEngineEvents>(event: U, ...args: Parameters<AlarmEngineEvents[U]>): boolean;
}

export class EnergyAlarmEngine extends EventEmitter {
  private activeAlerts: Map<string, Alert & { status?: string }> = new Map();
  private monitoringState: Map<string, MonitoringState> = new Map();
  private powerFactorAlerts: Set<string> = new Set();
  private transformerAlerts: Set<string> = new Set();
  private meterPoints: MeterPoint[] = [];
  private stats: AlarmEngineStats = {
    totalAlerts: 0,
    activeAlerts: 0,
    abnormalMonitoring: 0,
    powerFactorAlerts: 0,
    transformerAlerts: 0,
    lastAlertAt: null,
  };

  setMeterPoints(points: MeterPoint[]) {
    this.meterPoints = points;
  }

  async processData(data: EnergyData | EnergyData[]): Promise<Alert[]> {
    const dataArray = Array.isArray(data) ? data : [data];
    const firedAlerts: Alert[] = [];

    for (const d of dataArray) {
      const meterPoint = this.meterPoints.find(mp => mp.id === d.meterPointId);
      if (!meterPoint) continue;

      const alerts = await this.analyze(d, meterPoint);
      for (const alert of alerts) {
        if (!this.activeAlerts.has(alert.id)) {
          this.activeAlerts.set(alert.id, alert);
          this.stats.totalAlerts++;
          this.stats.activeAlerts = this.activeAlerts.size;
          this.stats.lastAlertAt = new Date().toISOString();
          firedAlerts.push(alert);
          this.emit('alert:fired', alert);
        }
      }
    }

    return firedAlerts;
  }

  private async analyze(data: EnergyData, meterPoint: MeterPoint): Promise<Alert[]> {
    const alerts: Alert[] = [];

    const abnormalAlert = await this.checkAbnormalUsage(data, meterPoint);
    if (abnormalAlert) alerts.push(abnormalAlert);

    if (meterPoint.type === 'electricity') {
      const pfAlert = this.checkPowerFactor(data, meterPoint);
      if (pfAlert) alerts.push(pfAlert);

      const tlAlert = this.checkTransformerOverload(data, meterPoint);
      if (tlAlert) alerts.push(tlAlert);
    }

    return alerts;
  }

  private async checkAbnormalUsage(
    data: EnergyData,
    meterPoint: MeterPoint
  ): Promise<Alert | null> {
    const key = `abnormal_${data.meterPointId}`;
    const threshold = meterPoint.historicalAverage * ABNORMAL_THRESHOLD_MULTIPLIER;

    if (data.value > threshold) {
      let state = this.monitoringState.get(key);
      if (!state) {
        state = {
          startTime: new Date(data.timestamp),
          value: data.value,
          count: 1,
        };
        this.monitoringState.set(key, state);
        this.stats.abnormalMonitoring = this.monitoringState.size;
        this.emit('monitoring:start', data.meterPointId, data.value);
      } else {
        state.value = data.value;
        state.count++;
      }

      const durationMinutes =
        (new Date(data.timestamp).getTime() - state.startTime.getTime()) / 60000;

      if (durationMinutes >= ABNORMAL_DURATION_MINUTES && state.count >= 2) {
        const status = getEnergyStatus(data.value, meterPoint.historicalAverage);
        const alertId = `abnormal_${data.meterPointId}_${state.startTime.toISOString()}`;

        if (!this.activeAlerts.has(alertId)) {
          const alert = {
            id: alertId,
            meterPointId: data.meterPointId,
            meterPointName: meterPoint.name,
            type: 'abnormal_usage' as AlertType,
            severity: 'high' as AlertSeverity,
            message: `${meterPoint.name} 能耗异常，当前值 ${data.value.toFixed(2)}${data.unit}，超过历史均值 ${ABNORMAL_THRESHOLD_MULTIPLIER} 倍，已持续 ${ABNORMAL_DURATION_MINUTES} 分钟`,
            value: data.value,
            threshold,
            status: status.status,
            startTime: state.startTime.toISOString(),
            acknowledged: false,
            timestamp: new Date().toISOString(),
            meterType: meterPoint.type,
          } as Alert & { status: string };

          await this.saveAlert(alert);
          this.monitoringState.delete(key);
          this.stats.abnormalMonitoring = this.monitoringState.size;
          return alert;
        }
      }
    } else {
      if (this.monitoringState.has(key)) {
        this.monitoringState.delete(key);
        this.stats.abnormalMonitoring = this.monitoringState.size;
        this.emit('monitoring:end', data.meterPointId, false);
      }
    }

    return null;
  }

  private checkPowerFactor(data: EnergyData, meterPoint: MeterPoint): Alert | null {
    if (data.powerFactor === undefined) return null;

    const key = `power_factor_${data.meterPointId}`;

    if (data.powerFactor < POWER_FACTOR_THRESHOLD) {
      if (!this.powerFactorAlerts.has(key)) {
        const alert = {
          id: `${key}_${Date.now()}`,
          meterPointId: data.meterPointId,
          meterPointName: meterPoint.name,
          type: 'power_factor' as AlertType,
          severity: 'medium' as AlertSeverity,
          message: `${meterPoint.name} 功率因数偏低: ${data.powerFactor.toFixed(3)}，低于阈值 ${POWER_FACTOR_THRESHOLD}，建议检查无功补偿设备`,
          value: data.powerFactor,
          threshold: POWER_FACTOR_THRESHOLD,
          status: 'warning',
          startTime: data.timestamp,
          acknowledged: false,
          timestamp: new Date().toISOString(),
          meterType: meterPoint.type,
        } as Alert & { status: string };

        this.powerFactorAlerts.add(key);
        this.stats.powerFactorAlerts = this.powerFactorAlerts.size;
        this.saveAlert(alert);
        return alert;
      }
    } else {
      if (this.powerFactorAlerts.has(key)) {
        this.powerFactorAlerts.delete(key);
        this.stats.powerFactorAlerts = this.powerFactorAlerts.size;
        this.clearActiveAlertsByPrefix(key);
      }
    }

    return null;
  }

  private checkTransformerOverload(data: EnergyData, meterPoint: MeterPoint): Alert | null {
    if (data.transformerLoad === undefined) return null;

    const key = `transformer_${data.meterPointId}`;

    if (data.transformerLoad > TRANSFORMER_LOAD_THRESHOLD) {
      if (!this.transformerAlerts.has(key)) {
        const alert = {
          id: `${key}_${Date.now()}`,
          meterPointId: data.meterPointId,
          meterPointName: meterPoint.name,
          type: 'transformer_overload' as AlertType,
          severity: 'critical' as AlertSeverity,
          message: `${meterPoint.name} 变压器过载: 负载率 ${(data.transformerLoad * 100).toFixed(1)}%，超过阈值 ${TRANSFORMER_LOAD_THRESHOLD * 100}%，请立即检查负载情况`,
          value: data.transformerLoad,
          threshold: TRANSFORMER_LOAD_THRESHOLD,
          status: 'alert',
          startTime: data.timestamp,
          acknowledged: false,
          timestamp: new Date().toISOString(),
          meterType: meterPoint.type,
        } as Alert & { status: string };

        this.transformerAlerts.add(key);
        this.stats.transformerAlerts = this.transformerAlerts.size;
        this.saveAlert(alert);
        return alert;
      }
    } else {
      if (this.transformerAlerts.has(key)) {
        this.transformerAlerts.delete(key);
        this.stats.transformerAlerts = this.transformerAlerts.size;
        this.clearActiveAlertsByPrefix(key);
      }
    }

    return null;
  }

  private clearActiveAlertsByPrefix(prefix: string) {
    for (const [id] of this.activeAlerts) {
      if (id.startsWith(prefix)) {
        this.activeAlerts.delete(id);
      }
    }
    this.stats.activeAlerts = this.activeAlerts.size;
  }

  private async saveAlert(alert: Alert & { status?: string }): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO alerts (id, meter_point_id, meter_point_name, type, severity, message,
                            value, threshold, status, start_time, acknowledged)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          alert.id,
          alert.meterPointId,
          alert.meterPointName,
          alert.type,
          alert.severity,
          alert.message,
          alert.value,
          alert.threshold,
          alert.status || 'active',
          new Date(alert.startTime),
          alert.acknowledged,
        ]
      );
    } catch (err) {
      console.error('Failed to save alert:', err);
    }
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getMonitoringCount(): number {
    return this.monitoringState.size;
  }

  getStats(): AlarmEngineStats {
    return { ...this.stats };
  }

  clearAllAlerts() {
    this.activeAlerts.clear();
    this.monitoringState.clear();
    this.powerFactorAlerts.clear();
    this.transformerAlerts.clear();
    this.stats = {
      totalAlerts: 0,
      activeAlerts: 0,
      abnormalMonitoring: 0,
      powerFactorAlerts: 0,
      transformerAlerts: 0,
      lastAlertAt: null,
    };
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  getAlertHistory(limit: number = 100): Promise<Alert[]> {
    return pool
      .query(
        `SELECT id, meter_point_id as "meterPointId", meter_point_name as "meterPointName",
                type, severity, message, value, threshold, status,
                start_time as "startTime", acknowledged
         FROM alerts
         ORDER BY start_time DESC
         LIMIT $1`,
        [limit]
      )
      .then(res => res.rows);
  }
}

export default new EnergyAlarmEngine();
