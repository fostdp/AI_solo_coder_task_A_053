import React, { useState, useEffect } from 'react';
import { Settings, X, DollarSign, Thermometer, TrendingUp, Leaf, Clock, Plus, Trash2 } from 'lucide-react';
import { useEnergyStore } from '../store';
import { api } from '../utils/api';
import type { PricingTier, ACControlStrategy } from '../../shared/types';

const periodLabels: Record<string, string> = {
  peak: '高峰时段',
  flat: '平段时段',
  valley: '低谷时段',
};

const periodColors: Record<string, string> = {
  peak: 'bg-red-100 text-red-700 border-red-200',
  flat: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  valley: 'bg-green-100 text-green-700 border-green-200',
};

const PricingSettings: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'pricing' | 'ac'>('pricing');
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [acStrategy, setAcStrategy] = useState<ACControlStrategy | null>(null);
  const [savings, setSavings] = useState<any>(null);
  const [currentPricing, setCurrentPricing] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const { acStatus } = useEnergyStore();

  useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen]);

  const loadData = async () => {
    try {
      const [tiers, strategy, currentPrice, savingData] = await Promise.all([
        api.getPricingTiers(),
        api.getACStrategy(),
        api.getCurrentPricing(),
        api.getACSavings(),
      ]);
      setPricingTiers(tiers);
      setAcStrategy(strategy);
      setCurrentPricing(currentPrice);
      setSavings(savingData);
    } catch (err) {
      console.error('Failed to load pricing data:', err);
    }
  };

  const handleSavePricing = async () => {
    setLoading(true);
    try {
      await api.updatePricingTiers(pricingTiers);
      await loadData();
    } catch (err) {
      console.error('Failed to save pricing:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAC = async () => {
    if (!acStrategy) return;
    setLoading(true);
    try {
      await api.updateACStrategy(acStrategy);
      await loadData();
    } catch (err) {
      console.error('Failed to save AC strategy:', err);
    } finally {
      setLoading(false);
    }
  };

  const addPricingTier = () => {
    const newTier: PricingTier = {
      id: `tier_${Date.now()}`,
      period: 'flat',
      startTime: '08:00',
      endTime: '12:00',
      price: 0.8,
      daysOfWeek: [1, 2, 3, 4, 5],
    };
    setPricingTiers([...pricingTiers, newTier]);
  };

  const removePricingTier = (id: string) => {
    setPricingTiers(pricingTiers.filter(t => t.id !== id));
  };

  const updatePricingTier = (id: string, field: keyof PricingTier, value: any) => {
    setPricingTiers(pricingTiers.map(t =>
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Settings className="w-5 h-5" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-[600px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">系统设置</h3>
                <p className="text-sm text-gray-500">电价与空调控制策略配置</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex gap-2 px-6 py-3 border-b border-gray-100">
              <button
                onClick={() => setActiveTab('pricing')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'pricing'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <DollarSign className="w-4 h-4 inline-block mr-1" />
                分时电价
              </button>
              <button
                onClick={() => setActiveTab('ac')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'ac'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Thermometer className="w-4 h-4 inline-block mr-1" />
                空调控制
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'pricing' ? (
                <div className="space-y-6">
                  {currentPricing && (
                    <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-blue-900">当前电价信息</h4>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${periodColors[currentPricing.currentTier.period]}`}>
                          {periodLabels[currentPricing.currentTier.period]}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs text-blue-700 mb-1">当前电价</div>
                          <div className="text-2xl font-bold text-blue-900">¥{currentPricing.currentTier.price.toFixed(2)}</div>
                          <div className="text-xs text-blue-600">元/kWh</div>
                        </div>
                        <div>
                          <div className="text-xs text-blue-700 mb-1">今日电费</div>
                          <div className="text-2xl font-bold text-blue-900">¥{currentPricing.dailyCost.toFixed(2)}</div>
                          <div className="text-xs text-blue-600">累计</div>
                        </div>
                        <div>
                          <div className="text-xs text-blue-700 mb-1">下一时段</div>
                          <div className="text-lg font-bold text-blue-900">{currentPricing.nextTier.startTime}</div>
                          <div className="text-xs text-blue-600">¥{currentPricing.nextTier.price.toFixed(2)} 元/kWh</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h4 className="font-semibold text-gray-900">电价时段配置</h4>
                      <button
                        onClick={addPricingTier}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        添加时段
                      </button>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {pricingTiers.map((tier) => (
                        <div key={tier.id} className="p-4 hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            <select
                              value={tier.period}
                              onChange={(e) => updatePricingTier(tier.id, 'period', e.target.value)}
                              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium"
                            >
                              <option value="peak">高峰时段</option>
                              <option value="flat">平段时段</option>
                              <option value="valley">低谷时段</option>
                            </select>
                            <div className="flex items-center gap-2">
                              <input
                                type="time"
                                value={tier.startTime}
                                onChange={(e) => updatePricingTier(tier.id, 'startTime', e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              />
                              <span className="text-gray-500">至</span>
                              <input
                                type="time"
                                value={tier.endTime}
                                onChange={(e) => updatePricingTier(tier.id, 'endTime', e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-gray-500">¥</span>
                              <input
                                type="number"
                                value={tier.price}
                                onChange={(e) => updatePricingTier(tier.id, 'price', parseFloat(e.target.value))}
                                step="0.01"
                                min="0"
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              />
                              <span className="text-gray-500 text-sm">/kWh</span>
                            </div>
                            <button
                              onClick={() => removePricingTier(tier.id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-gray-500">适用星期:</span>
                            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                              const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
                              const isSelected = tier.daysOfWeek.includes(day);
                              return (
                                <button
                                  key={day}
                                  onClick={() => {
                                    const newDays = isSelected
                                      ? tier.daysOfWeek.filter(d => d !== day)
                                      : [...tier.daysOfWeek, day];
                                    updatePricingTier(tier.id, 'daysOfWeek', newDays.sort());
                                  }}
                                  className={`w-7 h-7 text-xs font-medium rounded transition-colors ${
                                    isSelected
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                                >
                                  {dayLabels[day]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSavePricing}
                      disabled={loading}
                      className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      {loading ? '保存中...' : '保存设置'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {acStatus && (
                    <div className={`rounded-xl p-5 ${
                      acStatus.isAdjusted
                        ? 'bg-gradient-to-r from-green-50 to-emerald-100 border border-green-200'
                        : 'bg-gradient-to-r from-gray-50 to-slate-100 border border-gray-200'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-gray-900">当前空调运行状态</h4>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          acStatus.isAdjusted
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {acStatus.isAdjusted ? '已调温节能' : '正常运行'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">设定温度</div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-gray-900">{acStatus.currentTemp}</span>
                            <span className="text-sm text-gray-500">°C</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">基准温度</div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-gray-900">{acStatus.baseTemp}</span>
                            <span className="text-sm text-gray-500">°C</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">温度调整</div>
                          <div className={`text-2xl font-bold ${acStatus.adjustment > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                            {acStatus.adjustment > 0 ? `+${acStatus.adjustment}°C` : `${acStatus.adjustment}°C`}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {savings && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Leaf className="w-5 h-5 text-green-600" />
                          <span className="text-sm font-semibold text-green-800">节能效果</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="text-xs text-green-600">今日节约</div>
                            <div className="text-xl font-bold text-green-700">¥{savings.dailySavings.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-green-600">本月节约</div>
                            <div className="text-xl font-bold text-green-700">¥{savings.monthlySavings.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-green-600">CO₂减排</div>
                            <div className="text-xl font-bold text-green-700">{savings.co2Reduction.toFixed(1)} kg</div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-5 h-5 text-blue-600" />
                          <span className="text-sm font-semibold text-blue-800">调整记录</span>
                        </div>
                        <div className="space-y-1">
                          {savings.tempAdjustments.slice(-5).reverse().map((adj: number, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="text-blue-600">调整 #{idx + 1}</span>
                              <span className="font-medium text-blue-700">+{adj}°C</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {acStrategy && (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h4 className="font-semibold text-gray-900">空调控制策略</h4>
                      </div>
                      <div className="p-4 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            基准温度
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="20"
                              max="28"
                              value={acStrategy.baseTemperature}
                              onChange={(e) => setAcStrategy({ ...acStrategy, baseTemperature: parseFloat(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-16 text-center text-lg font-semibold text-gray-900">
                              {acStrategy.baseTemperature}°C
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            高峰时段温度调整
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="5"
                              step="0.5"
                              value={acStrategy.peakAdjustment}
                              onChange={(e) => setAcStrategy({ ...acStrategy, peakAdjustment: parseFloat(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-16 text-center text-lg font-semibold text-green-600">
                              +{acStrategy.peakAdjustment}°C
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            平段时段温度调整
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="0"
                              max="3"
                              step="0.5"
                              value={acStrategy.flatAdjustment}
                              onChange={(e) => setAcStrategy({ ...acStrategy, flatAdjustment: parseFloat(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-16 text-center text-lg font-semibold text-amber-600">
                              +{acStrategy.flatAdjustment}°C
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-t border-gray-100">
                          <span className="text-sm font-medium text-gray-700">启用自动控制</span>
                          <button
                            onClick={() => setAcStrategy({ ...acStrategy, enabled: !acStrategy.enabled })}
                            className={`relative w-12 h-6 rounded-full transition-colors ${
                              acStrategy.enabled ? 'bg-blue-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                acStrategy.enabled ? 'left-7' : 'left-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {acStrategy && (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-orange-50 border-b border-orange-200">
                        <h4 className="font-semibold text-gray-900">环境约束配置</h4>
                        <p className="text-xs text-gray-600 mt-1">当环境参数超过阈值时，自动降低温度调整幅度</p>
                      </div>
                      <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between py-2 border-b border-gray-100">
                          <div>
                            <span className="text-sm font-medium text-gray-700">CO₂浓度约束</span>
                            <p className="text-xs text-gray-500">超过阈值时降低调温幅度</p>
                          </div>
                          <button
                            onClick={() => setAcStrategy({ ...acStrategy, co2ConstraintEnabled: !acStrategy.co2ConstraintEnabled })}
                            className={`relative w-12 h-6 rounded-full transition-colors ${
                              acStrategy.co2ConstraintEnabled ? 'bg-orange-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                acStrategy.co2ConstraintEnabled ? 'left-7' : 'left-1'
                              }`}
                            />
                          </button>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            CO₂浓度阈值 (ppm)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="600"
                              max="2000"
                              step="50"
                              value={acStrategy.co2Threshold}
                              onChange={(e) => setAcStrategy({ ...acStrategy, co2Threshold: parseInt(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-20 text-center text-lg font-semibold text-gray-900">
                              {acStrategy.co2Threshold}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between py-2 border-t border-gray-100">
                          <div>
                            <span className="text-sm font-medium text-gray-700">人员密度约束</span>
                            <p className="text-xs text-gray-500">人员密集时降低调温幅度</p>
                          </div>
                          <button
                            onClick={() => setAcStrategy({ ...acStrategy, occupancyConstraintEnabled: !acStrategy.occupancyConstraintEnabled })}
                            className={`relative w-12 h-6 rounded-full transition-colors ${
                              acStrategy.occupancyConstraintEnabled ? 'bg-orange-500' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                acStrategy.occupancyConstraintEnabled ? 'left-7' : 'left-1'
                              }`}
                            />
                          </button>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            人员密度阈值 (人/区域)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="20"
                              max="200"
                              step="5"
                              value={acStrategy.occupancyThreshold}
                              onChange={(e) => setAcStrategy({ ...acStrategy, occupancyThreshold: parseInt(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-20 text-center text-lg font-semibold text-gray-900">
                              {acStrategy.occupancyThreshold}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            温度上限 (°C)
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="24"
                              max="30"
                              step="0.5"
                              value={acStrategy.tempLimitHigh}
                              onChange={(e) => setAcStrategy({ ...acStrategy, tempLimitHigh: parseFloat(e.target.value) })}
                              className="flex-1"
                            />
                            <span className="w-20 text-center text-lg font-semibold text-gray-900">
                              {acStrategy.tempLimitHigh}°C
                            </span>
                          </div>
                        </div>

                        {acStatus?.constraintReason && (
                          <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <p className="text-sm text-orange-700">
                              ⚠️ 当前约束：{acStatus.constraintReason}
                            </p>
                            {acStatus?.co2Level !== undefined && (
                              <div className="flex gap-4 mt-2 text-xs text-orange-600">
                                <span>CO₂: {acStatus.co2Level}ppm</span>
                                <span>人员: {acStatus.occupancyCount}</span>
                                <span>室温: {acStatus.indoorTemp}°C</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {savings?.constraintsTriggered && (
                    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                      <h4 className="font-semibold text-gray-900 mb-3">约束触发统计 (近7天)</h4>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold text-orange-600">{savings.constraintsTriggered.co2}</div>
                          <div className="text-xs text-gray-500">CO₂约束</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-orange-600">{savings.constraintsTriggered.occupancy}</div>
                          <div className="text-xs text-gray-500">人员约束</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-orange-600">{savings.constraintsTriggered.temp}</div>
                          <div className="text-xs text-gray-500">温度约束</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveAC}
                      disabled={loading}
                      className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      {loading ? '保存中...' : '保存设置'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default PricingSettings;

