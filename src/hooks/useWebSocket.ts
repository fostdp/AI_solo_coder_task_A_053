import { useEffect, useRef, useCallback } from 'react';
import { useEnergyStore } from '../store';
import type { WSMessage, MeterPoint, EnergyData, Alert, EnergyTotals, ACStatus } from '../../shared/types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const {
    setMeterPoints,
    updateEnergyData,
    setTotals,
    addAlert,
    setACStatus,
    setWsConnected,
  } = useEnergyStore();

  const showNotification = useCallback((alert: Alert) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const severityLabel = alert.severity === 'critical' ? '严重' : '警告';
      new Notification(`能源${severityLabel}告警`, {
        body: alert.message,
        icon: '/favicon.ico',
        tag: alert.id,
        requireInteraction: alert.severity === 'critical',
      });
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'meter_points':
          setMeterPoints(message.data as MeterPoint[]);
          break;
        case 'data_report':
          updateEnergyData(message.data as EnergyData[]);
          break;
        case 'totals_update':
          setTotals(message.data as EnergyTotals);
          break;
        case 'alert_push':
          addAlert(message.data as Alert);
          showNotification(message.data as Alert);
          break;
        case 'ac_status':
          setACStatus(message.data as ACStatus);
          break;
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  }, [setMeterPoints, updateEnergyData, setTotals, addAlert, setACStatus, showNotification]);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;
        
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        
        const maxReconnectDelay = 30000;
        const baseDelay = 1000;
        const delay = Math.min(
          baseDelay * Math.pow(2, reconnectAttemptsRef.current),
          maxReconnectDelay
        );
        
        reconnectAttemptsRef.current++;
        console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (err) {
      console.error('Error creating WebSocket:', err);
    }
  }, [handleMessage, setWsConnected]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
  }, [setWsConnected]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const sendData = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return {
    sendData,
    reconnect: connect,
  };
}
