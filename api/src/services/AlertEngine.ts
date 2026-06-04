import pool from '../config/database';
import dataService from './DataService';
import type { Alert, EnergyData, MeterPoint } from '../../../shared/types';

interface AlertState {
  abnormalUsage: Map<string, { startTime: Date; value: number; count: number }>;
  powerFactor: Set<string>;
  transformerOverload: Set<string>;
}

export class AlertEngine {
  private alertState: AlertState = {
    abnormalUsage: new Map(),
    powerFactor: new Set(),
    transformerOverload: new Set(),
  };

  private activeAlerts: Map<string, Alert> = new Map();

  private ABNORMAL_THRESHOLD_MULTIPLIER = 3;
  private ABNORMAL_DURATION_MINUTES = 5;
  private POWER_FACTOR_THRESHOLD = 0.85;
  private TRANSFORMER_LOAD_THRESHOLD = 0.90;

  async checkAbnormalUsage(data: EnergyData, meterPoint: MeterPoint): Promise<Alert | null> {
    const historicalAvg = meterPoint.historicalAverage;
    if (historicalAvg <= 0) return null;

    const ratio = data.value / historicalAvg;
    const threshold = historicalAvg * this.ABNORMAL_THRESHOLD_MULTIPLIER;

    if (data.value > threshold) {
      const state = this.alertState.abnormalUsage.get(data.meterPointId);
      const now = new Date(data.timestamp);

      if (!state) {
        this.alertState.abnormalUsage.set(data.meterPointId, {
          startTime: now,
          value: data.value,
          count: 1,
        });
        return null;
      }

      state.count++;
      state.value = data.value;

      const durationMs = now.getTime() - state.startTime.getTime();
      const durationMinutes = durationMs / (1000 * 60);

      if (durationMinutes >= this.ABNORMAL_DURATION_MINUTES) {
        const alertId = `ABNORMAL_${data.meterPointId}_${state.startTime.getTime()}`;

        if (!this.activeAlerts.has(alertId)) {
          const alert: Alert = {
            id: alertId,
            type: 'abnormal_usage',
            meterPointId: data.meterPointId,
            meterPointName: meterPoint.name,
            meterType: meterPoint.type,
            severity: 'critical',
            message: `${meterPoint.name} 能耗异常，当前值 ${data.value.toFixed(2)} 超过历史均值 ${historicalAvg.toFixed(2)} 的3倍，已持续 ${durationMinutes.toFixed(1)} 分钟`,
            value: data.value,
            threshold,
            timestamp: now.toISOString(),
            startTime: state.startTime.toISOString(),
            durationMinutes: Math.round(durationMinutes),
            acknowledged: false,
            createdAt: now.toISOString(),
          };
          await this.saveAlert(alert);
          this.activeAlerts.set(alertId, alert);
          return alert;
        }
      }
    } else {
      this.alertState.abnormalUsage.delete(data.meterPointId);
    }
    return null;
  }

  checkPowerFactor(data: EnergyData, meterPoint: MeterPoint): Alert | null {
    if (data.powerFactor === undefined || data.powerFactor >= this.POWER_FACTOR_THRESHOLD) {
      this.alertState.powerFactor.delete(data.meterPointId);
      return null;
    }

    const alertId = `PF_${data.meterPointId}`;
    if (!this.activeAlerts.has(alertId)) {
      const alert: Alert = {
        id: alertId,
        type: 'power_factor',
        meterPointId: data.meterPointId,
        meterPointName: meterPoint.name,
        meterType: meterPoint.type,
        severity: 'warning',
        message: `${meterPoint.name} 功率因数过低，当前值 ${data.powerFactor.toFixed(3)}，低于阈值 ${this.POWER_FACTOR_THRESHOLD}`,
        value: data.powerFactor,
        threshold: this.POWER_FACTOR_THRESHOLD,
        timestamp: new Date(data.timestamp).toISOString(),
        startTime: new Date(data.timestamp).toISOString(),
        acknowledged: false,
        createdAt: new Date().toISOString(),
      };
      this.saveAlert(alert);
      this.activeAlerts.set(alertId, alert);
      this.alertState.powerFactor.add(data.meterPointId);
      return alert;
    }
    return null;
  }

  checkTransformerOverload(data: EnergyData, meterPoint: MeterPoint): Alert | null {
    if (data.transformerLoad === undefined || data.transformerLoad < this.TRANSFORMER_LOAD_THRESHOLD) {
      this.alertState.transformerOverload.delete(data.meterPointId);
      return null;
    }

    const alertId = `OVERLOAD_${data.meterPointId}`;
    if (!this.activeAlerts.has(alertId)) {
      const alert: Alert = {
        id: alertId,
        type: 'transformer_overload',
        meterPointId: data.meterPointId,
        meterPointName: meterPoint.name,
        meterType: meterPoint.type,
        severity: 'critical',
        message: `${meterPoint.name} 变压器过载，当前负载率 ${(data.transformerLoad * 100).toFixed(1)}%，超过阈值 ${this.TRANSFORMER_LOAD_THRESHOLD * 100}%`,
        value: data.transformerLoad,
        threshold: this.TRANSFORMER_LOAD_THRESHOLD,
        timestamp: new Date(data.timestamp).toISOString(),
        startTime: new Date(data.timestamp).toISOString(),
        acknowledged: false,
        createdAt: new Date().toISOString(),
      };
      this.saveAlert(alert);
      this.activeAlerts.set(alertId, alert);
      this.alertState.transformerOverload.add(data.meterPointId);
      return alert;
    }
    return null;
  }

  async processData(data: EnergyData, meterPoint: MeterPoint): Promise<Alert[]> {
    const alerts: Alert[] = [];

    const abnormalAlert = await this.checkAbnormalUsage(data, meterPoint);
    if (abnormalAlert) alerts.push(abnormalAlert);

    if (meterPoint.type === 'electricity') {
      const pfAlert = this.checkPowerFactor(data, meterPoint);
      if (pfAlert) alerts.push(pfAlert);

      const overloadAlert = this.checkTransformerOverload(data, meterPoint);
      if (overloadAlert) alerts.push(overloadAlert);
    }

    return alerts;
  }

  private async saveAlert(alert: Alert): Promise<void> {
    await pool.query(
      `INSERT INTO alerts (id, type, meter_point_id, severity, message, value, threshold, start_time, acknowledged, acknowledged_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        alert.id,
        alert.type,
        alert.meterPointId,
        alert.severity,
        alert.message,
        alert.value,
        alert.threshold,
        new Date(alert.startTime),
        alert.acknowledged,
        alert.acknowledgedAt ? new Date(alert.acknowledgedAt) : null,
        new Date(),
      ]
    );
  }

  async getAlerts(includeAcknowledged: boolean = false, limit: number = 100): Promise<Alert[]> {
    let meterPoints: MeterPoint[] = [];
    try {
      meterPoints = await dataService.getMeterPoints();
    } catch (err) {
      try {
        const config = await import('../../../config/meter_points.json', { with: { type: 'json' } });
        meterPoints = config.default as MeterPoint[];
      } catch (e) {
        meterPoints = [];
      }
    }

    const result = await pool.query(
      `SELECT id, type, meter_point_id as "meterPointId", severity, message, 
              value, threshold, start_time as "startTime", acknowledged, 
              acknowledged_at as "acknowledgedAt", created_at as "createdAt"
       FROM alerts
       ${includeAcknowledged ? '' : 'WHERE acknowledged = false'}
       ORDER BY start_time DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row: any) => {
      const mp = meterPoints.find((m: any) => m.id === row.meterPointId);
      return {
        ...row,
        meterPointName: mp?.name || '未知计量点',
        meterType: mp?.type || 'electricity',
        timestamp: row.createdAt || row.startTime,
        durationMinutes: row.startTime ? Math.round((Date.now() - new Date(row.startTime).getTime()) / 60000) : undefined,
      };
    });
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE alerts SET acknowledged = true, acknowledged_at = NOW() WHERE id = $1 RETURNING *`,
      [alertId]
    );

    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
    }

    return (result.rowCount ?? 0) > 0;
  }

  getEnergyStatus(value: number, historicalAvg: number): { status: 'normal' | 'warning' | 'alert'; ratio: number } {
    if (historicalAvg <= 0) {
      return { status: 'normal', ratio: 1 };
    }
    const ratio = value / historicalAvg;
    if (ratio < 0.8) {
      return { status: 'normal', ratio };
    } else if (ratio <= 1.2) {
      return { status: 'warning', ratio };
    } else {
      return { status: 'alert', ratio };
    }
  }
}

export default new AlertEngine();
