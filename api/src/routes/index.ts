import { Router, Request, Response } from 'express';
import dataService from '../services/DataService';
import alertEngine from '../services/AlertEngine';
import pricingService from '../services/PricingService';
import acControlService from '../services/AcControlService';
import dbMaintenance from '../services/DatabaseMaintenanceService';
import type { PricingTier, ACControlStrategy } from '../../../shared/types';
import type { ControlStrategy } from '../services/LoadController';

const router = Router();

router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/meter-points', async (req: Request, res: Response) => {
  try {
    const points = await dataService.getMeterPoints();
    if (points.length === 0) {
      const config = require('../../../config/meter_points.json');
      return res.json(config);
    }
    res.json(points);
  } catch (err) {
    console.error('Error getting meter points:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/meter-points/:id', async (req: Request, res: Response) => {
  try {
    const point = await dataService.getMeterPointById(req.params.id);
    if (!point) {
      const config = require('../../../config/meter_points.json');
      const mp = config.find((m: any) => m.id === req.params.id);
      if (mp) return res.json(mp);
      return res.status(404).json({ error: 'Meter point not found' });
    }
    res.json(point);
  } catch (err) {
    console.error('Error getting meter point:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/energy-data/:id/24h', async (req: Request, res: Response) => {
  try {
    const data = await dataService.get24HourData(req.params.id);
    if (data.length === 0) {
      const mp = await dataService.getMeterPointById(req.params.id) || 
                require('../../../config/meter_points.json').find((m: any) => m.id === req.params.id);
      if (mp) {
        const now = Date.now();
        const mockData = [];
        for (let i = 96; i >= 0; i--) {
          const timestamp = new Date(now - i * 15 * 60 * 1000);
          const baseValue = mp.historicalAverage * (0.7 + Math.random() * 0.6);
          mockData.push({
            meterPointId: req.params.id,
            timestamp: timestamp.toISOString(),
            value: Math.round(baseValue * 10000) / 10000,
            unit: mp.type === 'electricity' || mp.type === 'cooling' ? 'kWh' : 'm³',
          });
        }
        return res.json(mockData);
      }
      return res.json([]);
    }
    res.json(data);
  } catch (err) {
    console.error('Error getting 24h data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/energy-data/:id/compare', async (req: Request, res: Response) => {
  try {
    const data = await dataService.getCompareData(req.params.id);
    
    if (data.current.length === 0) {
      const mp = await dataService.getMeterPointById(req.params.id) || 
                require('../../../config/meter_points.json').find((m: any) => m.id === req.params.id);
      if (mp) {
        const generateMockTrend = (baseAvg: number) => {
          const now = Date.now();
          const points = [];
          for (let i = 24; i >= 0; i--) {
            const timestamp = new Date(now - i * 60 * 60 * 1000);
            const value = baseAvg * (0.7 + Math.random() * 0.6);
            points.push({
              timestamp: timestamp.toISOString(),
              value: Math.round(value * 100) / 100,
            });
          }
          return points;
        };

        const current = generateMockTrend(mp.historicalAverage);
        const yesterday = generateMockTrend(mp.historicalAverage * 0.95);
        const lastWeek = generateMockTrend(mp.historicalAverage * 1.02);

        const sum = (arr: any[]) => arr.reduce((acc, p) => acc + p.value, 0);
        const currentTotal = sum(current);
        const yesterdayTotal = sum(yesterday);
        const lastWeekTotal = sum(lastWeek);

        return res.json({
          current,
          yesterday: yesterday.map(p => ({
            ...p,
            timestamp: new Date(new Date(p.timestamp).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          })),
          lastWeek: lastWeek.map(p => ({
            ...p,
            timestamp: new Date(new Date(p.timestamp).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })),
          currentTotal: Math.round(currentTotal * 100) / 100,
          yesterdayTotal: Math.round(yesterdayTotal * 100) / 100,
          lastWeekTotal: Math.round(lastWeekTotal * 100) / 100,
          yoyChange: yesterdayTotal > 0 ? Math.round(((currentTotal - yesterdayTotal) / yesterdayTotal) * 10000) / 100 : 0,
          momChange: lastWeekTotal > 0 ? Math.round(((currentTotal - lastWeekTotal) / lastWeekTotal) * 10000) / 100 : 0,
        });
      }
    }
    
    res.json(data);
  } catch (err) {
    console.error('Error getting compare data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/totals', async (req: Request, res: Response) => {
  try {
    const serverTime = new Date();
    const totals = await dataService.getTotals();
    const pricingInfo = await pricingService.getCurrentPricingInfo();
    
    res.json({
      ...totals,
      currentCost: Math.round(pricingInfo.todayCost * 100) / 100,
      currentElectricityCost: Math.round(pricingInfo.dailyCost * 100) / 100,
      todayCost: Math.round(pricingInfo.dailyCost * 100) / 100,
      monthCost: Math.round(pricingInfo.monthCost * 100) / 100,
      currentPrice: pricingInfo.price,
      currentPeriod: pricingInfo.period,
      serverTimestamp: serverTime.toISOString(),
    });
  } catch (err) {
    console.error('Error getting totals:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const includeAcknowledged = req.query.include_ack === 'true';
    const limit = parseInt(req.query.limit as string) || 100;
    const alerts = await alertEngine.getAlerts(includeAcknowledged, limit);
    res.json(alerts);
  } catch (err) {
    console.error('Error getting alerts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const success = await alertEngine.acknowledgeAlert(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error acknowledging alert:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing', async (req: Request, res: Response) => {
  try {
    const tiers = await pricingService.getPricingTiers();
    res.json(tiers);
  } catch (err) {
    console.error('Error getting pricing tiers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/pricing', async (req: Request, res: Response) => {
  try {
    const tiers = req.body as PricingTier[];
    if (!Array.isArray(tiers) || tiers.length === 0) {
      return res.status(400).json({ error: 'Invalid pricing tiers' });
    }
    await pricingService.updatePricingTiers(tiers);
    res.json({ success: true, tiers });
  } catch (err) {
    console.error('Error updating pricing tiers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing/current', async (req: Request, res: Response) => {
  try {
    const info = await pricingService.getCurrentPricingInfo();
    res.json(info);
  } catch (err) {
    console.error('Error getting current pricing:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing/breakdown', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const breakdown = await pricingService.getCostBreakdown(days);
    res.json(breakdown);
  } catch (err) {
    console.error('Error getting cost breakdown:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing/suggestion', async (req: Request, res: Response) => {
  try {
    const peakStartHour = parseInt(req.query.peakStartHour as string) || 8;
    const peakEndHour = parseInt(req.query.peakEndHour as string) || 21;
    const peakPrice = parseFloat(req.query.peakPrice as string) || 1.25;
    const flatPrice = parseFloat(req.query.flatPrice as string) || 0.75;
    const valleyPrice = parseFloat(req.query.valleyPrice as string) || 0.35;
    const suggestion = await pricingService.getSuggestedTiers(peakStartHour, peakEndHour, peakPrice, flatPrice, valleyPrice);
    res.json(suggestion);
  } catch (err) {
    console.error('Error getting pricing suggestion:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/pricing/validate', async (req: Request, res: Response) => {
  try {
    const tiers = req.body as PricingTier[];
    if (!Array.isArray(tiers)) {
      return res.status(400).json({ error: 'Invalid pricing tiers' });
    }
    const validation = await pricingService.validateTiers(tiers);
    res.json(validation);
  } catch (err) {
    console.error('Error validating pricing tiers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing/statistics', async (req: Request, res: Response) => {
  try {
    const [avgPrice, peakPrice, valleyPrice, isPeak, minutesToNext] = await Promise.all([
      pricingService.getAveragePrice(),
      pricingService.getPeakPrice(),
      pricingService.getValleyPrice(),
      pricingService.isPeakHour(),
      pricingService.getMinutesUntilNextPeriod(),
    ]);
    res.json({
      averagePrice: Math.round(avgPrice * 10000) / 10000,
      peakPrice: Math.round(peakPrice * 10000) / 10000,
      valleyPrice: Math.round(valleyPrice * 10000) / 10000,
      isPeakHour: isPeak,
      minutesToNextPeriod: minutesToNext,
    });
  } catch (err) {
    console.error('Error getting pricing statistics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control', async (req: Request, res: Response) => {
  try {
    const strategy = await acControlService.getStrategy();
    res.json(strategy);
  } catch (err) {
    console.error('Error getting AC control strategy:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ac-control', async (req: Request, res: Response) => {
  try {
    const strategy = req.body as ACControlStrategy;
    const updated = await acControlService.updateStrategy(strategy);
    res.json({ success: true, strategy: updated });
  } catch (err) {
    console.error('Error updating AC control strategy:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/status', async (req: Request, res: Response) => {
  try {
    const status = await acControlService.getStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting AC status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/recommendation', async (req: Request, res: Response) => {
  try {
    const recommendation = await acControlService.getAdjustmentRecommendation();
    res.json(recommendation);
  } catch (err) {
    console.error('Error getting AC recommendation:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/savings', async (req: Request, res: Response) => {
  try {
    const report = await acControlService.getEnergySavingsReport();
    res.json(report);
  } catch (err) {
    console.error('Error getting savings report:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/forecast', async (req: Request, res: Response) => {
  try {
    const baseLoadKw = parseFloat(req.query.baseLoadKw as string) || 200;
    const controlStrategy = (req.query.strategy as ControlStrategy) || 'balanced';
    const forecast = await acControlService.getLoadForecast(baseLoadKw, controlStrategy);
    res.json(forecast);
  } catch (err) {
    console.error('Error getting load forecast:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/reduction-potential', async (req: Request, res: Response) => {
  try {
    const currentLoadKw = parseFloat(req.query.currentLoadKw as string);
    if (!currentLoadKw || currentLoadKw <= 0) {
      return res.status(400).json({ error: 'Invalid currentLoadKw parameter' });
    }
    const potential = await acControlService.getLoadReductionPotential(currentLoadKw);
    res.json(potential);
  } catch (err) {
    console.error('Error getting reduction potential:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ac-control/optimized-schedule', async (req: Request, res: Response) => {
  try {
    const targetSavingsPercent = parseFloat(req.query.targetSavings as string) || 15;
    const maxComfortImpact = (req.query.comfortImpact as 'low' | 'medium' | 'high') || 'medium';
    const schedule = await acControlService.getOptimizedSchedule(targetSavingsPercent, maxComfortImpact);
    res.json(schedule);
  } catch (err) {
    console.error('Error getting optimized schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ac-control/validate', async (req: Request, res: Response) => {
  try {
    const strategy = req.body as ACControlStrategy;
    const validation = await acControlService.validateStrategy(strategy);
    res.json(validation);
  } catch (err) {
    console.error('Error validating strategy:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/maintenance/status', async (req: Request, res: Response) => {
  try {
    const status = await dbMaintenance.getMaintenanceStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting maintenance status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/maintenance/vacuum', async (req: Request, res: Response) => {
  try {
    await dbMaintenance.runVacuum();
    res.json({ success: true, message: 'VACUUM ANALYZE completed' });
  } catch (err) {
    console.error('Error running VACUUM:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/maintenance/ensure-partitions', async (req: Request, res: Response) => {
  try {
    await dbMaintenance.ensurePartitions();
    res.json({ success: true, message: 'Partitions ensured' });
  } catch (err) {
    console.error('Error ensuring partitions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/maintenance/purge', async (req: Request, res: Response) => {
  try {
    await dbMaintenance.purgeOldData();
    await dbMaintenance.dropOldPartitions();
    res.json({ success: true, message: 'Old data purged' });
  } catch (err) {
    console.error('Error purging old data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
