import React, { useState, useEffect } from 'react';
import { Bell, X, AlertTriangle, Zap, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useEnergyStore } from '../store';
import { api } from '../utils/api';
import { formatDateTime, getMeterTypeLabel, formatDuration } from '../utils/format';
import type { Alert } from '../../shared/types';

const alertTypeIcons: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  abnormal_usage: { icon: AlertTriangle, color: 'text-red-600', bgColor: 'bg-red-100' },
  power_factor: { icon: Zap, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  transformer_overload: { icon: AlertCircle, color: 'text-orange-600', bgColor: 'bg-orange-100' },
};

const AlertPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unacknowledged' | 'abnormal_usage' | 'power_factor' | 'transformer_overload'>('unacknowledged');
  const { alerts, unacknowledgedAlerts, acknowledgeAlert, setAlerts } = useEnergyStore();

  useEffect(() => {
    const loadAlerts = async () => {
      try {
        const data = await api.getAlerts(true, 200);
        setAlerts(data);
      } catch (err) {
        console.error('Failed to load alerts:', err);
      }
    };
    loadAlerts();
  }, [setAlerts]);

  const handleAcknowledge = async (alertId: string) => {
    try {
      await api.acknowledgeAlert(alertId);
      acknowledgeAlert(alertId);
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
      acknowledgeAlert(alertId);
    }
  };

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'unacknowledged') return !alert.acknowledged;
    return alert.type === filter;
  });

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unacknowledgedAlerts.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unacknowledgedAlerts.length > 99 ? '99+' : unacknowledgedAlerts.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">告警中心</h3>
                <p className="text-sm text-gray-500">
                  {unacknowledgedAlerts.length} 条未处理告警
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex gap-2 px-6 py-3 border-b border-gray-100 overflow-x-auto">
              {[
                { key: 'unacknowledged', label: '未处理' },
                { key: 'all', label: '全部' },
                { key: 'abnormal_usage', label: '异常用能' },
                { key: 'power_factor', label: '无功补偿' },
                { key: 'transformer_overload', label: '变压器过载' },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key as any)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                    filter === item.key
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
                  <p className="text-lg font-medium">暂无告警</p>
                  <p className="text-sm">所有设备运行正常</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredAlerts.map((alert) => {
                    const typeConfig = alertTypeIcons[alert.type] || alertTypeIcons.abnormal_usage;
                    const Icon = typeConfig.icon;

                    return (
                      <div
                        key={alert.id}
                        className={`p-4 hover:bg-gray-50 transition-colors ${
                          !alert.acknowledged ? 'bg-red-50/50' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${typeConfig.bgColor} flex-shrink-0`}>
                            <Icon className={`w-5 h-5 ${typeConfig.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className={`font-medium ${
                                alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'
                              }`}>
                                {alert.message}
                              </h4>
                              {!alert.acknowledged && (
                                <button
                                  onClick={() => handleAcknowledge(alert.id)}
                                  className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors flex-shrink-0"
                                >
                                  确认
                                </button>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                              <div>
                                <span className="text-gray-400">计量点: </span>
                                {alert.meterPointName} ({alert.meterPointId})
                              </div>
                              <div>
                                <span className="text-gray-400">类型: </span>
                                {getMeterTypeLabel(alert.meterType)}
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDateTime(alert.timestamp)}
                                {alert.durationMinutes && (
                                  <span className="text-gray-400 ml-2">
                                    持续 {formatDuration(alert.durationMinutes)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {alert.acknowledged && alert.acknowledgedAt && (
                              <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle className="w-3 h-3" />
                                已于 {formatDateTime(alert.acknowledgedAt)} 确认
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default AlertPanel;
