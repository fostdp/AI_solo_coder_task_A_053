import WebSocket from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

interface MeterPoint {
  id: string;
  name: string;
  type: 'electricity' | 'water' | 'gas' | 'cooling';
  floor: number;
  position: { x: number; y: number };
  area: string;
  unit: string;
  ratedPower: number;
  historicalAverage: number;
  location: string;
}

interface SimulatorConfig {
  wsUrl: string;
  intervalMs: number;
  enabled: boolean;
  anomalyProbability: number;
  powerFactorRange: { min: number; max: number };
  transformerLoadRange: { min: number; max: number };
  co2Range: { min: number; max: number };
  occupancyRange: { min: number; max: number };
  indoorTempRange: { min: number; max: number };
}

interface SimulatedData {
  meterPointId: string;
  value: number;
  unit: string;
  timestamp: string;
  powerFactor?: number;
  transformerLoad?: number;
  co2Level?: number;
  occupancyCount?: number;
  indoorTemp?: number;
}

interface SimulatorStats {
  totalMessages: number;
  totalBytes: number;
  startTime: Date;
  lastMessageAt: Date | null;
  errors: number;
  reconnects: number;
  anomalyGenerated: number;
}

class EnergyDataSimulator {
  private ws: WebSocket | null = null;
  private meterPoints: MeterPoint[] = [];
  private config: SimulatorConfig;
  private timer: NodeJS.Timeout | null = null;
  private stats: SimulatorStats;
  private lastValues: Map<string, number> = new Map();
  private isRunning: boolean = false;

  constructor() {
    this.config = {
      wsUrl: process.env.WEBSOCKET_URL || 'ws://localhost:3001',
      intervalMs: parseInt(process.env.SIMULATOR_INTERVAL || '15000'),
      enabled: process.env.SIMULATOR_ENABLED !== 'false',
      anomalyProbability: 0.02,
      powerFactorRange: { min: 0.82, max: 0.98 },
      transformerLoadRange: { min: 0.4, max: 0.95 },
      co2Range: { min: 400, max: 1500 },
      occupancyRange: { min: 10, max: 150 },
      indoorTempRange: { min: 22, max: 28 },
    };

    this.stats = {
      totalMessages: 0,
      totalBytes: 0,
      startTime: new Date(),
      lastMessageAt: null,
      errors: 0,
      reconnects: 0,
      anomalyGenerated: 0,
    };

    this.loadMeterPoints();
  }

  private loadMeterPoints(): void {
    try {
      const configPath = path.join(__dirname, '../config/meter_points.json');
      const rawData = fs.readFileSync(configPath, 'utf-8');
      this.meterPoints = JSON.parse(rawData);
      console.log(`[Simulator] Loaded ${this.meterPoints.length} meter points`);
    } catch (err) {
      console.error('[Simulator] Failed to load meter points:', err);
      process.exit(1);
    }
  }

  private getTimeBasedMultiplier(): number {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;

    if (isWeekend) {
      if (hour >= 10 && hour <= 20) return 1.0;
      if (hour >= 8 && hour <= 22) return 0.7;
      return 0.3;
    }

    if (hour >= 8 && hour <= 10) return 0.9;
    if (hour >= 10 && hour <= 12) return 1.15;
    if (hour >= 12 && hour <= 14) return 0.85;
    if (hour >= 14 && hour <= 18) return 1.2;
    if (hour >= 18 && hour <= 21) return 1.1;
    if (hour >= 6 && hour <= 8) return 0.6;
    if (hour >= 21 && hour <= 23) return 0.4;
    return 0.2;
  }

  private generateValue(point: MeterPoint, isAnomaly: boolean): number {
    const lastValue = this.lastValues.get(point.id) || point.historicalAverage;
    const timeMultiplier = this.getTimeBasedMultiplier();
    const baseValue = point.historicalAverage * timeMultiplier;
    
    let volatility = 0.05;
    switch (point.type) {
      case 'electricity': volatility = 0.08; break;
      case 'water': volatility = 0.03; break;
      case 'gas': volatility = 0.02; break;
      case 'cooling': volatility = 0.1; break;
    }

    const randomWalk = (Math.random() - 0.5) * 2 * volatility * baseValue;
    let value = lastValue + randomWalk;

    if (isAnomaly) {
      const anomalyMultiplier = 2 + Math.random() * 4;
      value = point.historicalAverage * anomalyMultiplier * timeMultiplier;
      this.stats.anomalyGenerated++;
      console.log(`[Simulator] Generating anomaly for ${point.name}: ${value.toFixed(2)} (avg: ${point.historicalAverage})`);
    }

    value = Math.max(baseValue * 0.3, Math.min(baseValue * 2, value));

    this.lastValues.set(point.id, value);
    return Math.round(value * 100) / 100;
  }

  private generatePowerFactor(isAnomaly: boolean): number {
    if (isAnomaly && Math.random() > 0.5) {
      return 0.7 + Math.random() * 0.1;
    }
    const { min, max } = this.config.powerFactorRange;
    return Math.round((min + Math.random() * (max - min)) * 1000) / 1000;
  }

  private generateTransformerLoad(isAnomaly: boolean): number {
    if (isAnomaly && Math.random() > 0.5) {
      return 0.92 + Math.random() * 0.15;
    }
    const { min, max } = this.config.transformerLoadRange;
    return Math.round((min + Math.random() * (max - min)) * 1000) / 1000;
  }

  private generateCo2Level(): number {
    const { min, max } = this.config.co2Range;
    const hour = new Date().getHours();
    let multiplier = 1;
    if (hour >= 9 && hour <= 18) multiplier = 1.3;
    if (hour >= 12 && hour <= 14) multiplier = 1.1;
    return Math.round(min + Math.random() * (max - min) * multiplier);
  }

  private generateOccupancy(): number {
    const { min, max } = this.config.occupancyRange;
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    
    let multiplier = isWeekend ? 0.5 : 1;
    if (hour >= 9 && hour <= 18) multiplier *= 1;
    else if (hour >= 8 && hour <= 20) multiplier *= 0.7;
    else multiplier *= 0.2;

    return Math.round(min + Math.random() * (max - min) * multiplier);
  }

  private generateIndoorTemp(): number {
    const { min, max } = this.config.indoorTempRange;
    const hour = new Date().getHours();
    let temp = min + Math.random() * (max - min);
    
    if (hour >= 12 && hour <= 16) temp += 1;
    if (hour >= 22 || hour <= 6) temp -= 1;
    
    return Math.round(temp * 10) / 10;
  }

  private generateSimulatedData(): SimulatedData[] {
    const data: SimulatedData[] = [];
    const now = new Date();
    const timestamp = now.toISOString();
    const electricPoints = this.meterPoints.filter(p => p.type === 'electricity');
    const isAnomalyHour = Math.random() < this.config.anomalyProbability;
    const anomalyPointIndex = isAnomalyHour 
      ? Math.floor(Math.random() * electricPoints.length) 
      : -1;

    for (let i = 0; i < this.meterPoints.length; i++) {
      const point = this.meterPoints[i];
      const isElectricityAnomaly = point.type === 'electricity' && 
        isAnomalyHour && 
        i === anomalyPointIndex;
      
      const isPowerFactorAnomaly = point.type === 'electricity' && 
        Math.random() < this.config.anomalyProbability * 0.3;
      
      const isTransformerAnomaly = point.type === 'electricity' && 
        point.name.includes('变压器') && 
        Math.random() < this.config.anomalyProbability * 0.2;

      const value = this.generateValue(point, isElectricityAnomaly);

      const simulatedData: SimulatedData = {
        meterPointId: point.id,
        value,
        unit: point.unit,
        timestamp,
      };

      if (point.type === 'electricity') {
        simulatedData.powerFactor = this.generatePowerFactor(isPowerFactorAnomaly);
        if (point.name.includes('变压器')) {
          simulatedData.transformerLoad = this.generateTransformerLoad(isTransformerAnomaly);
        }
        simulatedData.co2Level = this.generateCo2Level();
        simulatedData.occupancyCount = this.generateOccupancy();
        simulatedData.indoorTemp = this.generateIndoorTemp();
      }

      data.push(simulatedData);
    }

    return data;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[Simulator] Connecting to ${this.config.wsUrl}...`);
      
      this.ws = new WebSocket(this.config.wsUrl, {
        handshakeTimeout: 10000,
      });

      this.ws.on('open', () => {
        console.log('[Simulator] WebSocket connected');
        resolve();
      });

      this.ws.on('error', (err) => {
        console.error('[Simulator] WebSocket error:', err.message);
        this.stats.errors++;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[Simulator] WebSocket disconnected: ${code} ${reason}`);
        if (this.isRunning) {
          this.stats.reconnects++;
          console.log('[Simulator] Attempting reconnection in 5s...');
          setTimeout(() => this.connect().catch(() => {}), 5000);
        }
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'pong') {
            console.log('[Simulator] Received pong from server');
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      });
    });
  }

  private async sendData(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[Simulator] WebSocket not ready, skipping data send');
      return;
    }

    const data = this.generateSimulatedData();
    const message = JSON.stringify({
      type: 'meterDataBatch',
      data,
      serverTimestamp: new Date().toISOString(),
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.ws!.send(message, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.stats.totalMessages++;
      this.stats.totalBytes += message.length;
      this.stats.lastMessageAt = new Date();

      if (this.stats.totalMessages % 20 === 0) {
        this.printStats();
      }
    } catch (err) {
      console.error('[Simulator] Failed to send data:', err);
      this.stats.errors++;
    }
  }

  private printStats(): void {
    const uptimeMs = Date.now() - this.stats.startTime.getTime();
    const uptimeHours = (uptimeMs / 1000 / 60 / 60).toFixed(2);
    const msgsPerMin = (this.stats.totalMessages / (uptimeMs / 1000 / 60)).toFixed(1);
    const mbSent = (this.stats.totalBytes / 1024 / 1024).toFixed(2);

    console.log(`
[Simulator] Stats:
  Uptime: ${uptimeHours}h
  Messages sent: ${this.stats.totalMessages}
  Data sent: ${mbSent}MB
  Rate: ${msgsPerMin} msg/min
  Errors: ${this.stats.errors}
  Reconnects: ${this.stats.reconnects}
  Anomalies generated: ${this.stats.anomalyGenerated}
  Last message: ${this.stats.lastMessageAt?.toISOString() || 'N/A'}
    `);
  }

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[Simulator] Simulator disabled via config');
      return;
    }

    if (this.isRunning) {
      console.log('[Simulator] Already running');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = new Date();

    await this.connect();

    for (const point of this.meterPoints) {
      this.lastValues.set(point.id, point.historicalAverage);
    }

    console.log(`[Simulator] Starting simulation with ${this.meterPoints.length} points, interval ${this.config.intervalMs}ms`);
    
    this.sendData();
    this.timer = setInterval(() => this.sendData(), this.config.intervalMs);

    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
      }
    }, 30000);

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  public stop(): void {
    console.log('[Simulator] Stopping...');
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.printStats();
    console.log('[Simulator] Stopped');
    process.exit(0);
  }

  public getStats(): SimulatorStats {
    return { ...this.stats };
  }
}

const simulator = new EnergyDataSimulator();
simulator.start().catch((err) => {
  console.error('[Simulator] Failed to start:', err);
  process.exit(1);
});

export default EnergyDataSimulator;
