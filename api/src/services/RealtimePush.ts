import { EventEmitter } from 'events';
import WebSocket, { Server as WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'http';
import type { EnergyData, EnergyTotals, Alert, MeterPoint, ACStatus } from '../../../shared/types';

export interface PushStats {
  connectedClients: number;
  messagesSent: number;
  bytesSent: number;
  errors: number;
  uptimeMs: number;
  startedAt: string;
}

export type PushEvents = {
  'client:connected': (client: WebSocket, id: string) => void;
  'client:disconnected': (id: string) => void;
  'message:sent': (type: string, count: number) => void;
  'client:message': (message: unknown, clientId: string) => void;
};

export interface PushMessage<T = unknown> {
  type: string;
  data: T;
  serverTimestamp?: string;
}

export declare interface RealtimePush {
  on<U extends keyof PushEvents>(event: U, listener: PushEvents[U]): this;
  emit<U extends keyof PushEvents>(event: U, ...args: Parameters<PushEvents[U]>): boolean;
}

export class RealtimePush extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private startTime: number = Date.now();
  private stats: PushStats = {
    connectedClients: 0,
    messagesSent: 0,
    bytesSent: 0,
    errors: 0,
    uptimeMs: 0,
    startedAt: new Date().toISOString(),
  };
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;

  attach(server: HttpServer, path: string = '/ws') {
    if (this.wss) {
      this.detach();
    }

    this.wss = new WebSocketServer({ server, path });

    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId(req);
      this.clients.set(clientId, ws);
      this.stats.connectedClients = this.clients.size;
      this.emit('client:connected', ws, clientId);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.emit('client:message', message, clientId);
        } catch (err) {
          console.warn(`[RealtimePush] Invalid message from client ${clientId}`);
        }
      });

      ws.on('error', (error) => {
        this.stats.errors++;
        console.error(`[RealtimePush] Client ${clientId} error:`, error.message);
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.stats.connectedClients = this.clients.size;
        this.emit('client:disconnected', clientId);
      });
    });

    this.startHeartbeat();
    console.log(`📡 RealtimePush attached to ${path}`);
  }

  detach() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      for (const ws of this.clients.values()) {
        ws.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
      this.stats.connectedClients = 0;
      console.log('📡 RealtimePush detached');
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, ws] of this.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (err) {
            this.clients.delete(id);
            this.stats.connectedClients = this.clients.size;
          }
        }
      }
    }, 30000);
  }

  private generateClientId(req?: import('http').IncomingMessage): string {
    this.clientIdCounter++;
    const ip = req?.socket?.remoteAddress || 'unknown';
    return `client_${Date.now()}_${this.clientIdCounter}_${ip}`;
  }

  broadcast<T>(message: PushMessage<T>): number {
    const serverTimestamp = new Date().toISOString();
    const fullMessage = { ...message, serverTimestamp };
    const data = JSON.stringify(fullMessage);
    const bytes = Buffer.byteLength(data);

    let sentCount = 0;
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
          sentCount++;
        } catch (err) {
          this.stats.errors++;
        }
      }
    }

    this.stats.messagesSent += sentCount;
    this.stats.bytesSent += bytes * sentCount;
    this.emit('message:sent', message.type, sentCount);

    return sentCount;
  }

  sendTo<T>(clientId: string, message: PushMessage<T>): boolean {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const serverTimestamp = new Date().toISOString();
    const fullMessage = { ...message, serverTimestamp };
    const data = JSON.stringify(fullMessage);

    try {
      ws.send(data);
      this.stats.messagesSent++;
      this.stats.bytesSent += Buffer.byteLength(data);
      return true;
    } catch (err) {
      this.stats.errors++;
      return false;
    }
  }

  broadcastDataReport(data: EnergyData[]): number {
    return this.broadcast({
      type: 'data_report',
      data,
    });
  }

  broadcastMeterPoints(points: MeterPoint[]): number {
    return this.broadcast({
      type: 'meter_points',
      data: points,
    });
  }

  broadcastTotals(totals: EnergyTotals): number {
    return this.broadcast({
      type: 'totals_update',
      data: totals,
    });
  }

  broadcastAlert(alert: Alert): number {
    return this.broadcast({
      type: 'alert_push',
      data: alert,
    });
  }

  broadcastACStatus(status: ACStatus): number {
    return this.broadcast({
      type: 'ac_status',
      data: {
        ...status,
        serverTimestamp: new Date().toISOString(),
      },
    });
  }

  sendWelcome(clientId: string, context: {
    meterPoints: MeterPoint[];
    latestData: EnergyData[];
    totals?: EnergyTotals;
    acStatus?: ACStatus;
  }): boolean {
    let success = this.sendTo(clientId, {
      type: 'meter_points',
      data: context.meterPoints,
    });

    if (context.totals) {
      success = this.sendTo(clientId, {
        type: 'totals_update',
        data: context.totals,
      }) && success;
    }

    if (context.latestData.length > 0) {
      success = this.sendTo(clientId, {
        type: 'data_report',
        data: context.latestData,
      }) && success;
    }

    if (context.acStatus) {
      success = this.sendTo(clientId, {
        type: 'ac_status',
        data: {
          ...context.acStatus,
          serverTimestamp: new Date().toISOString(),
        },
      }) && success;
    }

    return success;
  }

  getStats(): PushStats {
    return {
      ...this.stats,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  resetStats() {
    this.stats = {
      connectedClients: this.clients.size,
      messagesSent: 0,
      bytesSent: 0,
      errors: 0,
      uptimeMs: 0,
      startedAt: new Date().toISOString(),
    };
    this.startTime = Date.now();
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  isClientConnected(clientId: string): boolean {
    const ws = this.clients.get(clientId);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }
}

export default new RealtimePush();
