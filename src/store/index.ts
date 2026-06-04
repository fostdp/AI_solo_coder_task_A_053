import { create } from 'zustand';
import type {
  MeterPoint,
  EnergyData,
  Alert,
  EnergyTotals,
  ACStatus,
  EnergyStatus,
} from '../../shared/types';

interface EnergyStore {
  meterPoints: MeterPoint[];
  energyData: Map<string, EnergyData>;
  latestStatus: Map<string, { status: EnergyStatus; ratio: number }>;
  totals: EnergyTotals | null;
  alerts: Alert[];
  unacknowledgedAlerts: Alert[];
  acStatus: ACStatus | null;
  selectedFloor: number;
  selectedMeterPoint: MeterPoint | null;
  isDetailPanelOpen: boolean;
  wsConnected: boolean;
  lastUpdate: Date | null;
  
  setMeterPoints: (points: MeterPoint[]) => void;
  updateEnergyData: (data: EnergyData[]) => void;
  setTotals: (totals: EnergyTotals) => void;
  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (alertId: string) => void;
  setAlerts: (alerts: Alert[]) => void;
  setACStatus: (status: ACStatus) => void;
  setSelectedFloor: (floor: number) => void;
  selectMeterPoint: (point: MeterPoint | null) => void;
  setDetailPanelOpen: (open: boolean) => void;
  setWsConnected: (connected: boolean) => void;
  getEnergyStatus: (value: number, historicalAvg: number) => { status: EnergyStatus; ratio: number };
  getFilteredMeterPoints: () => MeterPoint[];
}

const getEnergyStatus = (value: number, historicalAvg: number): { status: EnergyStatus; ratio: number } => {
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
};

export const useEnergyStore = create<EnergyStore>((set, get) => ({
  meterPoints: [],
  energyData: new Map(),
  latestStatus: new Map(),
  totals: null,
  alerts: [],
  unacknowledgedAlerts: [],
  acStatus: null,
  selectedFloor: 1,
  selectedMeterPoint: null,
  isDetailPanelOpen: false,
  wsConnected: false,
  lastUpdate: null,

  setMeterPoints: (points) => set({ meterPoints: points }),

  updateEnergyData: (data) => {
    const state = get();
    const newEnergyData = new Map(state.energyData);
    const newStatus = new Map(state.latestStatus);

    for (const d of data) {
      newEnergyData.set(d.meterPointId, d);
      const mp = state.meterPoints.find(m => m.id === d.meterPointId);
      if (mp) {
        const status = getEnergyStatus(d.value, mp.historicalAverage);
        newStatus.set(d.meterPointId, status);
      }
    }

    set({
      energyData: newEnergyData,
      latestStatus: newStatus,
      lastUpdate: new Date(),
    });
  },

  setTotals: (totals) => set({ totals }),

  addAlert: (alert) => {
    const state = get();
    const exists = state.alerts.some(a => a.id === alert.id);
    if (!exists) {
      const newAlerts = [alert, ...state.alerts];
      const newUnacked = [alert, ...state.unacknowledgedAlerts];
      set({
        alerts: newAlerts.slice(0, 200),
        unacknowledgedAlerts: newUnacked,
      });
    }
  },

  acknowledgeAlert: (alertId) => {
    const state = get();
    set({
      alerts: state.alerts.map(a =>
        a.id === alertId ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString() } : a
      ),
      unacknowledgedAlerts: state.unacknowledgedAlerts.filter(a => a.id !== alertId),
    });
  },

  setAlerts: (alerts) => set({
    alerts,
    unacknowledgedAlerts: alerts.filter(a => !a.acknowledged),
  }),

  setACStatus: (status) => set({ acStatus: status }),

  setSelectedFloor: (floor) => set({ selectedFloor: floor }),

  selectMeterPoint: (point) => set({
    selectedMeterPoint: point,
    isDetailPanelOpen: point !== null,
  }),

  setDetailPanelOpen: (open) => set({
    isDetailPanelOpen: open,
    selectedMeterPoint: open ? get().selectedMeterPoint : null,
  }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  getEnergyStatus,

  getFilteredMeterPoints: () => {
    const state = get();
    return state.meterPoints.filter(mp => mp.floor === state.selectedFloor);
  },
}));
