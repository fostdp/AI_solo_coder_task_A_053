import React from 'react';
import { Zap, Droplets, Flame, Snowflake, TrendingUp, TrendingDown } from 'lucide-react';
import { useEnergyStore } from '../store';
import { formatNumber, formatCurrency } from '../utils/format';

const cardConfigs = [
  {
    key: 'electricity',
    label: '总用电',
    unit: 'kWh',
    icon: Zap,
    color: 'from-amber-500 to-orange-600',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
  },
  {
    key: 'water',
    label: '总用水',
    unit: 'm³',
    icon: Droplets,
    color: 'from-blue-500 to-cyan-600',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
  },
  {
    key: 'gas',
    label: '总燃气',
    unit: 'm³',
    icon: Flame,
    color: 'from-red-500 to-orange-600',
    bgColor: 'bg-red-50',
    textColor: 'text-red-700',
  },
  {
    key: 'cooling',
    label: '总冷量',
    unit: 'kWh',
    icon: Snowflake,
    color: 'from-cyan-500 to-blue-600',
    bgColor: 'bg-cyan-50',
    textColor: 'text-cyan-700',
  },
] as const;

const TotalCards: React.FC = () => {
  const { totals, acStatus } = useEnergyStore();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cardConfigs.map((config) => {
        const value = totals?.[config.key] || 0;
        const trend = totals?.trends?.[config.key] || 0;
        const Icon = config.icon;
        const isPositive = trend >= 0;

        return (
          <div
            key={config.key}
            className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
          >
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-500 mb-1">{config.label}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-gray-900">
                      {formatNumber(value)}
                    </span>
                    <span className="text-sm text-gray-500">{config.unit}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        isPositive ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {isPositive ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {Math.abs(trend).toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-400">较昨日</span>
                  </div>
                </div>
                <div
                  className={`p-3 rounded-xl bg-gradient-to-br ${config.color} shadow-lg`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
            {config.key === 'electricity' && totals?.currentElectricityCost !== undefined && (
              <div className={`px-5 py-3 ${config.bgColor} border-t border-gray-100`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${config.textColor}`}>
                    当前电费
                  </span>
                  <span className={`text-lg font-bold ${config.textColor}`}>
                    ¥{formatCurrency(totals.currentElectricityCost)}
                  </span>
                </div>
                {totals?.currentPrice !== undefined && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${config.textColor} opacity-70`}>
                      电价：¥{totals.currentPrice.toFixed(2)}/kWh ({totals.currentPeriod === 'peak' ? '高峰' : totals.currentPeriod === 'flat' ? '平段' : '低谷'})
                    </span>
                  </div>
                )}
                {acStatus?.currentPeriod && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${config.textColor} opacity-70`}>
                      设定温度：{acStatus.currentSetPoint}°C
                    </span>
                    {acStatus.adjustmentReduced && (
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full" title={acStatus.constraintReason}>
                        环境约束
                      </span>
                    )}
                    {acStatus.isAdjusted && !acStatus.adjustmentReduced && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                        已调温 +{acStatus.adjustment}°C
                      </span>
                    )}
                  </div>
                )}
                {acStatus?.co2Level !== undefined && (
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs ${config.textColor} opacity-70`}>
                      CO₂: {acStatus.co2Level}ppm
                    </span>
                    <span className={`text-xs ${config.textColor} opacity-70`}>
                      人员: {acStatus.occupancyCount}
                    </span>
                  </div>
                )}
                {totals?.serverTimestamp && (
                  <div className="text-xs text-gray-400 mt-1">
                    更新时间：{new Date(totals.serverTimestamp).toLocaleTimeString('zh-CN')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TotalCards;
