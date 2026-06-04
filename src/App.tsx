import React, { useEffect } from 'react';
import { Building2, Activity, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { useEnergyStore } from './store';
import { api } from './utils/api';
import { formatDateTime } from './utils/format';
import TotalCards from './components/TotalCards';
import FloorPlan from './components/FloorPlan';
import MeterDetailPanel from './components/MeterDetailPanel';
import AlertPanel from './components/AlertPanel';
import PricingSettings from './components/PricingSettings';

const App: React.FC = () => {
  const { wsConnected, lastUpdate, meterPoints, setMeterPoints, setTotals } = useEnergyStore();

  useWebSocket();

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [points, totals] = await Promise.all([
          api.getMeterPoints(),
          api.getTotals(),
        ]);
        setMeterPoints(points);
        setTotals(totals);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    };
    loadInitialData();
  }, [setMeterPoints, setTotals]);

  const statusCounts = {
    normal: 0,
    warning: 0,
    alert: 0,
  };

  for (const mp of meterPoints) {
    const status = useEnergyStore.getState().latestStatus.get(mp.id);
    if (status) {
      statusCounts[status.status]++;
    } else {
      statusCounts.normal++;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg">
                  <Building2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">智能楼宇能源管理系统</h1>
                  <p className="text-xs text-gray-500">Smart Building Energy Management System</p>
                </div>
              </div>

              <div className="h-10 w-px bg-gray-200 mx-2" />

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">
                    共 <span className="font-semibold text-gray-700">{meterPoints.length}</span> 个计量点
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <span className="text-sm text-gray-600">{statusCounts.normal} 正常</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <span className="text-sm text-gray-600">{statusCounts.warning} 偏高</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-sm text-gray-600">{statusCounts.alert} 异常</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <RefreshCw className={`w-4 h-4 ${wsConnected ? 'text-green-500 animate-spin' : 'text-gray-400'}`} style={{ animationDuration: '3s' }} />
                {lastUpdate && (
                  <span>更新于 {formatDateTime(lastUpdate)}</span>
                )}
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                wsConnected
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {wsConnected ? (
                  <>
                    <Wifi className="w-4 h-4" />
                    <span>实时连接</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4" />
                    <span>连接断开</span>
                  </>
                )}
              </div>
              <AlertPanel />
              <PricingSettings />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <TotalCards />
        <FloorPlan />
      </main>

      <MeterDetailPanel />
    </div>
  );
};

export default App;
