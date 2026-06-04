import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MeterPoint, MeterType } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, '../config/meter_points.json');
const outputPath = path.join(__dirname, '../config/meter_points.json');

const METER_UNITS: Record<MeterType, string> = {
  electricity: 'kWh',
  water: 'm³',
  gas: 'm³',
  cooling: 'kWh',
};

const extractArea = (name: string, location: string): string => {
  const areaMatch = name.match(/-(.+?)-[水电气冷]/);
  if (areaMatch) return areaMatch[1];
  const locMatch = location.match(/\d+层\s+(.+)/);
  if (locMatch) return locMatch[1];
  return '未分类区域';
};

const convertData = () => {
  const rawData = fs.readFileSync(inputPath, 'utf-8');
  const oldFormat: any[] = JSON.parse(rawData);

  const newFormat: MeterPoint[] = oldFormat.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    floor: item.floor,
    position: {
      x: item.x,
      y: item.y,
    },
    area: extractArea(item.name, item.location || ''),
    unit: METER_UNITS[item.type],
    model: `Model-${item.type.toUpperCase()}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    installDate: `2024-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    ratedPower: item.ratedPower,
    historicalAverage: item.historicalAverage,
    location: item.location,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  fs.writeFileSync(outputPath, JSON.stringify(newFormat, null, 2));
  console.log(`✅ 成功转换 ${newFormat.length} 个计量点配置`);
};

convertData();
