import { Server as HttpServer } from 'http';
import dataService from './DataService';
import meterCollector from './MeterCollector';
import alarmEngine from './EnergyAlarmEngine';
import realtimePush from './RealtimePush';
import pricingService from './PricingService';
import acControlService from './AcControlService';
import type { MeterPoint, EnergyData, EnergyTotals } from '../../../shared/types';

export class EnergyWebSocketServer {
  private meterPoints: MeterPoint[] = [];
  private latestData: Map<string, EnergyData> = new Map();
  private totals: EnergyTotals | null = null;
  private dataSimulator: NodeJS.Timeout | null = null;
  private totalsInterval: NodeJS.Timeout | null = null;
  private server: HttpServer | null = null;

  async init(server: HttpServer) {
    this.server = server;

    this.meterPoints = await dataService.getMeterPoints();
    if (this.meterPoints.length === 0) {
      console.log('Loading meter points from config file...');
      const config = await import('../../../config/meter_points.json', { with: { type: 'json' } });
      this.meterPoints = config.default as MeterPoint[];
    }

    meterCollector.setMeterPoints(this.meterPoints);
    alarmEngine.setMeterPoints(this.meterPoints);

    this.setupServiceIntegration();

    realtimePush.attach(server, '/ws');
    this.setupClientHandling();

    this.startDataSimulation();
    this.startTotalsUpdate();

    console.log('✅ WebSocket coordination server started');
    console.log(`   - MeterCollector: ${this.meterPoints.length} points registered`);
    console.log(`   - EnergyAlarmEngine: ready`);
    console.log(`   - RealtimePush: listening on /ws`);
  }

  private setupServiceIntegration() {
    meterCollector.on('data:received', (data) => {
      console.log(`📥 Received ${data.length} data points`);
    });

    meterCollector.on('data:error', (error, data) => {
      console.error('❌ Data collection error:', error.message);
    });

    meterCollector.on('data:stored', async (data) => {
      for (const d of data) {
        this.latestData.set(d.meterPointId, d);

        if (d.co2Level !== undefined || d.occupancyCount !== undefined) {
          const envDataMap = new Map<string, { co2Level: number; occupancyCount: number; indoorTemp: number }>();
          envDataMap.set(d.meterPointId, {
            co2Level: d.co2Level || 0,
            occupancyCount: d.occupancyCount || 0,
            indoorTemp: d.indoorTemp || 24.0,
          });
          acControlService.setEnvironmentData(envDataMap);
        }
      }

      realtimePush.broadcastDataReport(data);

      const alerts = await alarmEngine.processData(data);
      for (const alert of alerts) {
        realtimePush.broadcastAlert(alert);
      }
    });

    alarmEngine.on('alert:fired', (alert) => {
      console.log(`🚨 Alert fired: ${alert.type} - ${alert.meterPointName}`);
    });

    alarmEngine.on('monitoring:start', (meterPointId, value) => {
      console.log(`👀 Monitoring started for ${meterPointId}: value=${value.toFixed(2)}`);
    });

    realtimePush.on('client:connected', (ws, clientId) => {
      console.log(`📡 Client connected: ${clientId}`);
      
      const latestArray = Array.from(this.latestData.values());
      realtimePush.sendWelcome(clientId, {
        meterPoints: this.meterPoints,
        latestData: latestArray,
        totals: this.totals || undefined,
        acStatus: undefined,
      });

      acControlService.getStatus().then(status => {
        realtimePush.broadcastACStatus(status);
      });
    });

    realtimePush.on('client:disconnected', (clientId) => {
      console.log(`📡 Client disconnected: ${clientId}`);
    });

    realtimePush.on('client:message', (message, clientId) => {
      this.handleClientMessage(message, clientId);
    });

    realtimePush.on('message:sent', (type, count) => {
      console.log(`📤 Broadcast '${type}' to ${count} clients`);
    });
  }

  private setupClientHandling() {
    realtimePush.on('client:connected', (ws, clientId) => {
      acControlService.getStatus().then(status => {
        realtimePush.sendTo(clientId, {
          type: 'ac_status',
          data: {
            ...status,
            serverTimestamp: new Date().toISOString(),
          },
        });
      });
    });
  }

  private async handleClientMessage(message: any, clientId: string) {
    if (message.type === 'data_report') {
      await this.processExternalData(message.data);
    } else if (message.type === 'subscribe') {
      console.log(`Client ${clientId} subscribed to: ${message.data}`);
    } else if (message.type === 'request_stats') {
      realtimePush.sendTo(clientId, {
        type: 'system_stats',
        data: {
          collector: meterCollector.getStats(),
          alarmEngine: alarmEngine.getStats(),
          push: realtimePush.getStats(),
        },
      });
    }
  }

  async processExternalData(data: EnergyData | EnergyData[]) {
    await meterCollector.collect(data);
  }

  private startDataSimulation() {
    const REPORT_INTERVAL = 15000;

    const simulateData = () => {
      const now = new Date();
      const data: EnergyData[] = [];
      const hour = now.getHours();
      
      const isWorkHour = hour >= 8 && hour < 20;
      const baseOccupancy = isWorkHour ? 0.6 : 0.1;

      for (const mp of this.meterPoints) {
        const baseValue = mp.historicalAverage * (0.7 + Math.random() * 0.6);
        
        let powerFactor: number | undefined;
        let transformerLoad: number | undefined;
        let co2Level: number | undefined;
        let occupancyCount: number | undefined;
        let indoorTemp: number | undefined;

        if (mp.type === 'electricity') {
          powerFactor = 0.82 + Math.random() * 0.15;
          
          if (mp.id.endsWith('0017') || mp.id.endsWith('069') || mp.id.endsWith('113')) {
            transformerLoad = 0.75 + Math.random() * 0.2;
          }
        }

        if (mp.type === 'cooling' || mp.id.includes('AHU') || mp.id.includes('空调')) {
          const occupancyVariance = Math.random() * 0.4;
          occupancyCount = Math.floor(baseOccupancy * 100 + occupancyVariance * 50);
          
          const baseCo2 = 400 + occupancyCount * 8;
          co2Level = Math.round(baseCo2 + (Math.random() - 0.5) * 100);
          
          const baseTemp = 24 + (Math.random() - 0.5) * 2;
          indoorTemp = Math.round(baseTemp * 10) / 10;
        }

        const d: EnergyData = {
          meterPointId: mp.id,
          timestamp: now.toISOString(),
          value: Math.round(baseValue * 10000) / 10000,
          unit: mp.type === 'electricity' || mp.type === 'cooling' ? 'kWh' : 'm³',
          powerFactor,
          transformerLoad,
          co2Level,
          occupancyCount,
          indoorTemp,
        };

        data.push(d);
      }

      meterCollector.collect(data);
    };

    this.dataSimulator = setInterval(simulateData, REPORT_INTERVAL);
    simulateData();

    console.log('🤖 Data simulation started, reporting every 15 seconds');
  }

  private async updateTotals() {
    const serverTime = new Date();
    const pricingInfo = await pricingService.getCurrentPricingInfo();
    const tiers = await pricingService.getPricingTiers();
    
    let electricityTotal = 0;
    let waterTotal = 0;
    let gasTotal = 0;
    let coolingTotal = 0;

    for (const d of this.latestData.values()) {
      const mp = this.meterPoints.find(m => m.id === d.meterPointId);
      if (!mp) continue;
      
      switch (mp.type) {
        case 'electricity':
          electricityTotal += d.value;
          break;
        case 'water':
          waterTotal += d.value;
          break;
        case 'gas':
          gasTotal += d.value;
          break;
        case 'cooling':
          coolingTotal += d.value;
          break;
      }
    }

    const instantaneousCost = electricityTotal * pricingInfo.price;

    this.totals = {
      electricity: Math.round(electricityTotal * 100) / 100,
      water: Math.round(waterTotal * 100) / 100,
      gas: Math.round(gasTotal * 100) / 100,
      cooling: Math.round(coolingTotal * 100) / 100,
      currentCost: Math.round(instantaneousCost * 100) / 100,
      currentElectricityCost: Math.round(pricingInfo.dailyCost * 100) / 100,
      todayCost: Math.round(pricingInfo.dailyCost * 100) / 100,
      monthCost: Math.round(pricingInfo.monthCost * 100) / 100,
      currentPrice: pricingInfo.price,
      currentPeriod: pricingInfo.period,
      trends: {
        electricity: (Math.random() - 0.5) * 20,
        water: (Math.random() - 0.5) * 20,
        gas: (Math.random() - 0.5) * 20,
        cooling: (Math.random() - 0.5) * 20,
      },
      electricityUnit: 'kWh',
      waterUnit: 'm³',
      gasUnit: 'm³',
      coolingUnit: 'kWh',
      serverTimestamp: serverTime.toISOString(),
    };

    realtimePush.broadcastTotals(this.totals);

    acControlService.getStatus(tiers).then(status => {
      realtimePush.broadcastACStatus(status);
    });
  }

  private startTotalsUpdate() {
    this.totalsInterval = setInterval(() => this.updateTotals(), 5000);
    this.updateTotals();
  }

  getMeterPoints(): MeterPoint[] {
    return this.meterPoints;
  }

  getLatestData(): Map<string, EnergyData> {
    return this.latestData;
  }

  getTotals(): EnergyTotals | null {
    return this.totals;
  }

  getSystemStats() {
    return {
      collector: meterCollector.getStats(),
      alarmEngine: alarmEngine.getStats(),
      push: realtimePush.getStats(),
    };
  }

  stop() {
    if (this.dataSimulator) {
      clearInterval(this.dataSimulator);
      console.log('🛑 Data simulator stopped');
    }
    if (this.totalsInterval) {
      clearInterval(this.totalsInterval);
      console.log('🛑 Totals updater stopped');
    }
    realtimePush.detach();
    console.log('🛑 WebSocket coordination server stopped');
  }
}

export default EnergyWebSocketServer;
