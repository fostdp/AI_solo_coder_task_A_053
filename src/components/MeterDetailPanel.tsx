import React, { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Clock, Calendar, Zap } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { useEnergyStore } from '../store';
import { api } from '../utils/api';
import type { EnergyData, CompareData } from '../../shared/types';
import { formatNumber, formatDateTime, formatTime, getMeterTypeLabel, getStatusLabel } from '../utils/format';
import { STATUS_COLORS } from '../../shared/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const MeterDetailPanel: React.FC = () => {
  const {
    selectedMeterPoint,
    isDetailPanelOpen,
    setDetailPanelOpen,
    energyData,
    latestStatus,
    getEnergyStatus,
  } = useEnergyStore();

  const [hourlyData, setHourlyData] = useState<EnergyData[]>([]);
  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'trend' | 'compare'>('trend');

  useEffect(() => {
    if (!selectedMeterPoint || !isDetailPanelOpen) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [hourly, compare] = await Promise.all([
          api.get24HourData(selectedMeterPoint.id),
          api.getCompareData(selectedMeterPoint.id),
        ]);
        setHourlyData(hourly);
        setCompareData(compare);
      } catch (err) {
        console.error('Failed to load meter data:', err);
        const mockHourly: EnergyData[] = [];
        const now = new Date();
        for (let i = 23; i >= 0; i--) {
          const time = new Date(now.getTime() - i * 3600000);
          const variance = (Math.random() - 0.5) * 0.4;
          mockHourly.push({
            meterPointId: selectedMeterPoint.id,
            timestamp: time.toISOString(),
            value: selectedMeterPoint.historicalAverage * (1 + variance),
            unit: selectedMeterPoint.unit,
          });
        }
        setHourlyData(mockHourly);
        setCompareData({
          today: mockHourly.slice(0, 12).reduce((sum, d) => sum + d.value, 0),
          yesterday: mockHourly.slice(0, 12).reduce((sum, d) => sum + d.value, 0) * (0.8 + Math.random() * 0.4),
          lastWeek: mockHourly.slice(0, 12).reduce((sum, d) => sum + d.value, 0) * (0.7 + Math.random() * 0.6),
          momChange: (Math.random() - 0.5) * 30,
          yoyChange: (Math.random() - 0.5) * 20,
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [selectedMeterPoint, isDetailPanelOpen]);

  if (!selectedMeterPoint || !isDetailPanelOpen) return null;

  const currentData = energyData.get(selectedMeterPoint.id);
  const currentValue = currentData?.value || selectedMeterPoint.historicalAverage;
  const statusInfo = latestStatus.get(selectedMeterPoint.id) || getEnergyStatus(currentValue, selectedMeterPoint.historicalAverage);

  const trendChartData = {
    labels: hourlyData.map(d => formatTime(d.timestamp)),
    datasets: [
      {
        label: '能耗值',
        data: hourlyData.map(d => d.value),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
      },
      {
        label: '历史均值',
        data: hourlyData.map(() => selectedMeterPoint.historicalAverage),
        borderColor: '#94a3b8',
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        tension: 0,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const compareChartData = compareData ? {
    labels: ['今日', '昨日', '上周同期'],
    datasets: [
      {
        label: '累计能耗',
        data: [compareData.today, compareData.yesterday, compareData.lastWeek],
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(148, 163, 184, 0.8)',
          'rgba(34, 197, 94, 0.8)',
        ],
        borderColor: ['#3b82f6', '#94a3b8', '#22c55e'],
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          padding: 20,
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: { size: 11 },
        },
      },
      y: {
        grid: {
          color: 'rgba(226, 232, 240, 0.5)',
        },
        ticks: {
          font: { size: 11 },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  };

  const statusColor = STATUS_COLORS[statusInfo.status];

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{selectedMeterPoint.name}</h3>
          <p className="text-sm text-gray-500">{selectedMeterPoint.id} · {getMeterTypeLabel(selectedMeterPoint.type)}</p>
        </div>
        <button
          onClick={() => setDetailPanelOpen(false)}
          className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4">
              <div className="text-sm font-medium text-blue-700 mb-1">当前值</div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-blue-900">{formatNumber(currentValue)}</span>
                <span className="text-sm text-blue-700">{selectedMeterPoint.unit}</span>
              </div>
              <div className="text-xs text-blue-600 mt-1">{formatDateTime(new Date())}</div>
            </div>

            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4">
              <div className="text-sm font-medium text-gray-700 mb-1">历史均值</div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-gray-900">{formatNumber(selectedMeterPoint.historicalAverage)}</span>
                <span className="text-sm text-gray-700">{selectedMeterPoint.unit}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">过去30天平均</div>
            </div>

            <div
              className="rounded-xl p-4"
              style={{
                background: statusInfo.status === 'normal'
                  ? 'linear-gradient(135deg, #dcfce7, #bbf7d0)'
                  : statusInfo.status === 'warning'
                  ? 'linear-gradient(135deg, #fef3c7, #fde68a)'
                  : 'linear-gradient(135deg, #fee2e2, #fecaca)',
              }}
            >
              <div
                className="text-sm font-medium mb-1"
                style={{ color: statusInfo.status === 'normal' ? '#15803d' : statusInfo.status === 'warning' ? '#a16207' : '#b91c1c' }}
              >
                运行状态
              </div>
              <div
                className="text-2xl font-bold"
                style={{ color: statusColor }}
              >
                {getStatusLabel(statusInfo.status)}
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: statusInfo.status === 'normal' ? '#16a34a' : statusInfo.status === 'warning' ? '#ca8a04' : '#dc2626' }}
              >
                {(statusInfo.ratio * 100).toFixed(1)}% 历史均值
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4">
              <div className="text-sm font-medium text-purple-700 mb-1">安装位置</div>
              <div className="text-lg font-bold text-purple-900">{selectedMeterPoint.floor}F · {selectedMeterPoint.area}</div>
              <div className="text-xs text-purple-600 mt-1">
                坐标: ({selectedMeterPoint.position.x}, {selectedMeterPoint.position.y})
              </div>
            </div>
          </div>

          {currentData?.powerFactor !== undefined && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-600" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-amber-900">功率因数</div>
                  <div className="text-lg font-bold text-amber-700">{currentData.powerFactor.toFixed(2)}</div>
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                  currentData.powerFactor >= 0.85 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {currentData.powerFactor >= 0.85 ? '正常' : '偏低'}
                </div>
              </div>
            </div>
          )}

          {currentData?.transformerLoad !== undefined && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <div className="text-sm font-medium text-orange-700 mb-2">变压器负载率</div>
              <div className="w-full h-3 bg-orange-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    currentData.transformerLoad >= 90 ? 'bg-red-500' : currentData.transformerLoad >= 70 ? 'bg-orange-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(currentData.transformerLoad, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs">
                <span className="text-gray-500">0%</span>
                <span className={`font-medium ${
                  currentData.transformerLoad >= 90 ? 'text-red-600' : 'text-gray-700'
                }`}>
                  {currentData.transformerLoad.toFixed(1)}%
                </span>
                <span className="text-red-500">90% 告警阈值</span>
              </div>
            </div>
          )}

          <div className="flex gap-2 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('trend')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'trend'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Clock className="w-4 h-4 inline-block mr-1" />
              24小时趋势
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === 'compare'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Calendar className="w-4 h-4 inline-block mr-1" />
              同环比对比
            </button>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : activeTab === 'trend' ? (
            <div>
              <div className="h-64">
                <Line data={trendChartData} options={chartOptions} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">最大值</div>
                  <div className="text-lg font-bold text-gray-900">
                    {formatNumber(Math.max(...hourlyData.map(d => d.value)))}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">最小值</div>
                  <div className="text-lg font-bold text-gray-900">
                    {formatNumber(Math.min(...hourlyData.map(d => d.value)))}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">平均值</div>
                  <div className="text-lg font-bold text-gray-900">
                    {formatNumber(hourlyData.reduce((s, d) => s + d.value, 0) / hourlyData.length)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            compareData && (
              <div>
                <div className="h-64">
                  <Bar data={compareChartData!} options={chartOptions} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className={`rounded-lg p-4 ${
                    compareData.yoyChange >= 0 ? 'bg-red-50' : 'bg-green-50'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {compareData.yoyChange >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-red-500" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-green-500" />
                      )}
                      <span className="text-sm font-medium text-gray-600">同比变化</span>
                    </div>
                    <div className={`text-2xl font-bold ${
                      compareData.yoyChange >= 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {compareData.yoyChange >= 0 ? '+' : ''}{compareData.yoyChange.toFixed(1)}%
                    </div>
                  </div>
                  <div className={`rounded-lg p-4 ${
                    compareData.momChange >= 0 ? 'bg-red-50' : 'bg-green-50'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {compareData.momChange >= 0 ? (
                        <TrendingUp className="w-4 h-4 text-red-500" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-green-500" />
                      )}
                      <span className="text-sm font-medium text-gray-600">环比变化</span>
                    </div>
                    <div className={`text-2xl font-bold ${
                      compareData.momChange >= 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {compareData.momChange >= 0 ? '+' : ''}{compareData.momChange.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          <div className="bg-gray-50 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">设备信息</h4>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div className="text-gray-500">设备型号</div>
              <div className="font-medium text-gray-700">{selectedMeterPoint.model}</div>
              <div className="text-gray-500">额定功率</div>
              <div className="font-medium text-gray-700">{selectedMeterPoint.ratedPower || 'N/A'} kW</div>
              <div className="text-gray-500">安装日期</div>
              <div className="font-medium text-gray-700">{selectedMeterPoint.installDate || 'N/A'}</div>
              <div className="text-gray-500">维护周期</div>
              <div className="font-medium text-gray-700">每季度</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeterDetailPanel;
