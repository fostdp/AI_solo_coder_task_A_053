import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEnergyStore } from '../store';
import type { MeterPoint, FloorPlanConfig, FloorLayout } from '../../shared/types';
import { STATUS_COLORS, METER_TYPE_COLORS } from '../../shared/types';
import { getMeterTypeLabel, getStatusLabel, formatNumber } from '../utils/format';
import floorLayoutConfig from '../../config/floor_layout.json';

const config = floorLayoutConfig as FloorPlanConfig;

const FloorPlan: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const pulsePhaseRef = useRef(0);
  const [hoveredMeter, setHoveredMeter] = useState<MeterPoint | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const {
    meterPoints,
    selectedFloor,
    latestStatus,
    energyData,
    selectMeterPoint,
    selectedMeterPoint,
    getFilteredMeterPoints,
    getEnergyStatus,
    setSelectedFloor,
  } = useEnergyStore();

  const filteredPoints = getFilteredMeterPoints();

  const currentFloorLayout = useMemo(() => {
    return config.floors.find(f => f.floor === selectedFloor) || config.floors[0];
  }, [selectedFloor]);

  const floorOptions = useMemo(() => {
    return config.floors.map(f => ({
      floor: f.floor,
      label: `${f.floor}F`,
      name: f.name,
    }));
  }, []);

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    const { canvas } = config;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, canvas.background.startColor);
    gradient.addColorStop(1, canvas.background.endColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { canvas } = config;
    const { padding, gridSize, gridColor } = canvas;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    
    for (let x = padding; x <= canvas.width - padding; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, canvas.height - padding);
      ctx.stroke();
    }
    
    for (let y = padding; y <= canvas.height - padding; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
    }
  }, []);

  const drawFloorOutline = useCallback((ctx: CanvasRenderingContext2D) => {
    const { canvas, floorPlan } = config;
    const { padding } = canvas;
    const { borderRadius, backgroundColor, borderColor } = floorPlan;

    const floorWidth = canvas.width - padding * 2;
    const floorHeight = canvas.height - padding * 2;

    ctx.fillStyle = backgroundColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(padding, padding, floorWidth, floorHeight, borderRadius);
    ctx.fill();
    ctx.stroke();
  }, []);

  const drawAreas = useCallback((ctx: CanvasRenderingContext2D, layout: FloorLayout) => {
    for (const area of layout.areas) {
      if (area.dash && area.dash.length > 0) {
        ctx.setLineDash(area.dash);
      } else {
        ctx.setLineDash([]);
      }

      ctx.fillStyle = area.fillColor;
      ctx.strokeStyle = area.borderColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(area.x, area.y, area.width, area.height, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#64748b';
      ctx.font = '600 14px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(area.name, area.x + 12, area.y + 24);
    }
  }, []);

  const drawStairs = useCallback((ctx: CanvasRenderingContext2D, layout: FloorLayout) => {
    const { stairs } = config.commonElements;
    
    for (const stair of layout.stairs) {
      ctx.fillStyle = stairs.fillColor;
      ctx.strokeStyle = stairs.borderColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(stair.x, stair.y, stair.width || 40, stair.height || 40, 4);
      ctx.fill();
      ctx.stroke();
    }

    if (layout.stairs.length > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      const firstStair = layout.stairs[0];
      const lastStair = layout.stairs[layout.stairs.length - 1];
      const centerX = (firstStair.x + (lastStair.x + (lastStair.width || 40))) / 2;
      ctx.fillText('楼梯间', centerX, firstStair.y + (firstStair.height || 40) + 18);
    }
  }, []);

  const drawElevators = useCallback((ctx: CanvasRenderingContext2D, layout: FloorLayout) => {
    const { elevator } = config.commonElements;
    
    for (const elev of layout.elevators) {
      if (elev.radius) {
        ctx.beginPath();
        ctx.arc(elev.x, elev.y, elev.radius, 0, Math.PI * 2);
        ctx.fillStyle = elevator.fillColor;
        ctx.fill();
        ctx.strokeStyle = elevator.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (layout.elevators.length > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      const firstElev = layout.elevators[0];
      const lastElev = layout.elevators[layout.elevators.length - 1];
      const centerX = (firstElev.x + lastElev.x) / 2;
      ctx.fillText('电梯', centerX, firstElev.y + (firstElev.radius || 20) + 18);
    }
  }, []);

  const drawMeterPoints = useCallback((ctx: CanvasRenderingContext2D, points: MeterPoint[]) => {
    pulsePhaseRef.current += 0.05;

    for (const mp of points) {
      const x = mp.position.x;
      const y = mp.position.y;
      const size = 28;

      const data = energyData.get(mp.id);
      const statusInfo = latestStatus.get(mp.id) || getEnergyStatus(data?.value || mp.historicalAverage, mp.historicalAverage);
      const status = statusInfo.status;
      const color = STATUS_COLORS[status];
      const typeColor = METER_TYPE_COLORS[mp.type];

      const isSelected = selectedMeterPoint?.id === mp.id;
      const isHovered = hoveredMeter?.id === mp.id;
      const pulseScale = status === 'alert' ? 1 + Math.sin(pulsePhaseRef.current) * 0.15 : 1;

      const actualSize = size * pulseScale * (isHovered || isSelected ? 1.2 : 1);

      const glowColor = status === 'alert' ? 'rgba(239, 68, 68, 0.4)' : status === 'warning' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.2)';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = status === 'alert' ? 20 : 10;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - actualSize / 2, y - actualSize / 2, actualSize, actualSize, 6);
      ctx.fill();

      ctx.shadowBlur = 0;

      ctx.strokeStyle = typeColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x - actualSize / 2, y - actualSize / 2, actualSize, actualSize, 6);
      ctx.stroke();

      if (isSelected) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.roundRect(x - actualSize / 2 - 6, y - actualSize / 2 - 6, actualSize + 12, actualSize + 12, 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const typeShort = mp.type === 'electricity' ? '电' : mp.type === 'water' ? '水' : mp.type === 'gas' ? '气' : '冷';
      ctx.fillText(typeShort, x, y);
    }
  }, [energyData, latestStatus, selectedMeterPoint, hoveredMeter, getEnergyStatus]);

  const drawLegend = useCallback((ctx: CanvasRenderingContext2D) => {
    const { canvas } = config;
    const legendX = canvas.padding + 20;
    const legendY = canvas.height - 30;

    ctx.fillStyle = '#64748b';
    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('状态:', legendX, legendY);

    const statusItems = [
      { label: '正常(<80%)', color: STATUS_COLORS.normal },
      { label: '偏高(80%-120%)', color: STATUS_COLORS.warning },
      { label: '异常(>120%)', color: STATUS_COLORS.alert },
    ];

    let offsetX = legendX + 50;
    for (const item of statusItems) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(offsetX, legendY - 8, 14, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#64748b';
      ctx.fillText(item.label, offsetX + 20, legendY + 3);
      offsetX += 120;
    }

    const typeItems = [
      { label: '电表', color: METER_TYPE_COLORS.electricity },
      { label: '水表', color: METER_TYPE_COLORS.water },
      { label: '燃气表', color: METER_TYPE_COLORS.gas },
      { label: '冷量表', color: METER_TYPE_COLORS.cooling },
    ];

    offsetX += 50;
    ctx.fillStyle = '#64748b';
    ctx.fillText('类型:', offsetX, legendY);
    offsetX += 40;

    for (const item of typeItems) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(offsetX, legendY - 8, 14, 14, 3);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(item.label, offsetX + 20, legendY + 3);
      offsetX += 70;
    }
  }, []);

  const drawFloorPlan = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { canvas: canvasConfig } = config;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasConfig.width * dpr;
    canvas.height = canvasConfig.height * dpr;
    canvas.style.width = `${canvasConfig.width}px`;
    canvas.style.height = `${canvasConfig.height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasConfig.width, canvasConfig.height);

    drawBackground(ctx);
    drawGrid(ctx);
    drawFloorOutline(ctx);
    drawAreas(ctx, currentFloorLayout);
    drawStairs(ctx, currentFloorLayout);
    drawElevators(ctx, currentFloorLayout);
    drawMeterPoints(ctx, filteredPoints);
    drawLegend(ctx);

    animationRef.current = requestAnimationFrame(drawFloorPlan);
  }, [currentFloorLayout, filteredPoints, drawBackground, drawGrid, drawFloorOutline, drawAreas, drawStairs, drawElevators, drawMeterPoints, drawLegend]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(drawFloorPlan);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawFloorPlan]);

  const getMeterAtPosition = useCallback((x: number, y: number): MeterPoint | null => {
    for (const mp of filteredPoints) {
      const size = 28;
      if (
        x >= mp.position.x - size &&
        x <= mp.position.x + size &&
        y >= mp.position.y - size &&
        y <= mp.position.y + size
      ) {
        return mp;
      }
    }
    return null;
  }, [filteredPoints]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x: e.clientX, y: e.clientY });

    const meter = getMeterAtPosition(x, y);
    setHoveredMeter(meter);
    canvas.style.cursor = meter ? 'pointer' : 'default';
  }, [getMeterAtPosition]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const meter = getMeterAtPosition(x, y);
    if (meter) {
      selectMeterPoint(meter);
    }
  }, [getMeterAtPosition, selectMeterPoint]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-900">楼层平面图</h2>
          <div className="flex items-center gap-1">
            {floorOptions.map((option) => (
              <button
                key={option.floor}
                onClick={() => setSelectedFloor(option.floor)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                  selectedFloor === option.floor
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title={option.name}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-500">{currentFloorLayout.name}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>本层共 {filteredPoints.length} 个计量点</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            实时更新
          </span>
        </div>
      </div>

      <div ref={containerRef} className="relative overflow-auto p-4">
        <canvas
          ref={canvasRef}
          width={config.canvas.width}
          height={config.canvas.height}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          className="rounded-lg border border-gray-200"
        />

        {hoveredMeter && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm"
            style={{
              left: mousePos.x + 15,
              top: mousePos.y + 15,
              maxWidth: '280px',
            }}
          >
            <div className="font-semibold mb-1">{hoveredMeter.name}</div>
            <div className="text-gray-300 text-xs space-y-0.5">
              <div>编号: {hoveredMeter.id}</div>
              <div>类型: {getMeterTypeLabel(hoveredMeter.type)}</div>
              <div>区域: {hoveredMeter.area}</div>
              <div>
                当前值: {formatNumber(energyData.get(hoveredMeter.id)?.value || hoveredMeter.historicalAverage)} {hoveredMeter.unit}
              </div>
              <div>
                状态: {getStatusLabel(latestStatus.get(hoveredMeter.id)?.status || 'normal')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FloorPlan;
