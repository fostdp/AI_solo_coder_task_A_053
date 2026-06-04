import { writeFileSync } from 'fs';
import { join } from 'path';
import type { MeterPoint } from '../shared/types';

function generateMeterPoints(): MeterPoint[] {
  const points: MeterPoint[] = [];
  const floors = [1, 2, 3, 4, 5];
  
  const floorLayouts = {
    1: { name: '一层商业', width: 1200, height: 800, zones: ['零售区A', '零售区B', '餐饮区', '大堂', '机房'] },
    2: { name: '二层办公', width: 1200, height: 800, zones: ['开放办公A', '开放办公B', '会议室', '经理室', '茶水间'] },
    3: { name: '三层办公', width: 1200, height: 800, zones: ['开放办公C', '开放办公D', '培训室', '接待区', '机房'] },
    4: { name: '四层酒店', width: 1200, height: 800, zones: ['客房区A', '客房区B', '餐厅', '健身房', '前台'] },
    5: { name: '五层设备', width: 1200, height: 800, zones: ['中央空调机房', '变配电室', '水泵房', '锅炉房', '电梯机房'] },
  };

  const typeDistribution = {
    electricity: 100,
    water: 40,
    gas: 30,
    cooling: 30,
  };

  let idCounter = 1;

  for (const floor of floors) {
    const layout = floorLayouts[floor as keyof typeof floorLayouts];
    
    const pointsPerFloor = 40;
    const perZone = Math.floor(pointsPerFloor / layout.zones.length);
    
    for (let zoneIdx = 0; zoneIdx < layout.zones.length; zoneIdx++) {
      const zone = layout.zones[zoneIdx];
      const zoneX = 50 + (zoneIdx % 3) * 380 + Math.random() * 100;
      const zoneY = 50 + Math.floor(zoneIdx / 3) * 350 + Math.random() * 100;
      
      for (let i = 0; i < perZone; i++) {
        const typeRand = Math.random();
        let type: 'electricity' | 'water' | 'gas' | 'cooling';
        
        if (typeRand < 0.5) type = 'electricity';
        else if (typeRand < 0.7) type = 'water';
        else if (typeRand < 0.85) type = 'gas';
        else type = 'cooling';
        
        const x = zoneX + (i % 4) * 70 + Math.random() * 30;
        const y = zoneY + Math.floor(i / 4) * 60 + Math.random() * 30;
        
        const historicalBase = type === 'electricity' ? 150 : type === 'water' ? 80 : type === 'gas' ? 50 : 120;
        
        const point: MeterPoint = {
          id: `MP-${String(idCounter).padStart(4, '0')}`,
          name: `${layout.name}-${zone}-${type === 'electricity' ? '电表' : type === 'water' ? '水表' : type === 'gas' ? '燃气表' : '冷量表'}-${String(i + 1).padStart(2, '0')}`,
          type,
          floor,
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          width: 45,
          height: 35,
          ratedPower: type === 'electricity' ? Math.round((50 + Math.random() * 200) * 100) / 100 : undefined,
          historicalAverage: Math.round((historicalBase * (0.8 + Math.random() * 0.4)) * 100) / 100,
          location: `${floor}层 ${zone}`,
        };
        
        points.push(point);
        idCounter++;
      }
    }
  }

  while (points.length < 200) {
    const floor = floors[Math.floor(Math.random() * floors.length)];
    const layout = floorLayouts[floor as keyof typeof floorLayouts];
    const typeRand = Math.random();
    let type: 'electricity' | 'water' | 'gas' | 'cooling';
    
    if (typeRand < 0.5) type = 'electricity';
    else if (typeRand < 0.7) type = 'water';
    else if (typeRand < 0.85) type = 'gas';
    else type = 'cooling';
    
    const zone = layout.zones[Math.floor(Math.random() * layout.zones.length)];
    const historicalBase = type === 'electricity' ? 150 : type === 'water' ? 80 : type === 'gas' ? 50 : 120;
    
    const point: MeterPoint = {
      id: `MP-${String(idCounter).padStart(4, '0')}`,
      name: `${layout.name}-${zone}-${type === 'electricity' ? '电表' : type === 'water' ? '水表' : type === 'gas' ? '燃气表' : '冷量表'}-补充`,
      type,
      floor,
      x: Math.round((50 + Math.random() * 1100) * 100) / 100,
      y: Math.round((50 + Math.random() * 700) * 100) / 100,
      width: 45,
      height: 35,
      ratedPower: type === 'electricity' ? Math.round((50 + Math.random() * 200) * 100) / 100 : undefined,
      historicalAverage: Math.round((historicalBase * (0.8 + Math.random() * 0.4)) * 100) / 100,
      location: `${floor}层 ${zone}`,
    };
    
    points.push(point);
    idCounter++;
  }

  return points.slice(0, 200);
}

function generateSQL(points: MeterPoint[]): string {
  let sql = '-- 计量点数据导入脚本\n\n';
  sql += 'INSERT INTO meter_points (id, name, type, floor, x, y, width, height, rated_power, historical_average, location) VALUES\n';
  
  const values = points.map(p => {
    const ratedPower = p.ratedPower !== undefined ? p.ratedPower : 'NULL';
    return `('${p.id}', '${p.name.replace(/'/g, "''")}', '${p.type}', ${p.floor}, ${p.x}, ${p.y}, ${p.width}, ${p.height}, ${ratedPower}, ${p.historicalAverage}, '${p.location.replace(/'/g, "''")}')`;
  });
  
  sql += values.join(',\n');
  sql += '\nON CONFLICT (id) DO UPDATE SET\n';
  sql += '  name = EXCLUDED.name,\n';
  sql += '  type = EXCLUDED.type,\n';
  sql += '  floor = EXCLUDED.floor,\n';
  sql += '  x = EXCLUDED.x,\n';
  sql += '  y = EXCLUDED.y,\n';
  sql += '  width = EXCLUDED.width,\n';
  sql += '  height = EXCLUDED.height,\n';
  sql += '  rated_power = EXCLUDED.rated_power,\n';
  sql += '  historical_average = EXCLUDED.historical_average,\n';
  sql += '  location = EXCLUDED.location,\n';
  sql += '  updated_at = CURRENT_TIMESTAMP;\n';
  
  return sql;
}

const points = generateMeterPoints();

const jsonPath = join(__dirname, '../config/meter_points.json');
writeFileSync(jsonPath, JSON.stringify(points, null, 2), 'utf-8');

const sqlPath = join(__dirname, '../migrations/002_insert_meter_points.sql');
writeFileSync(sqlPath, generateSQL(points), 'utf-8');

console.log(`Generated ${points.length} meter points`);
console.log(`JSON saved to: ${jsonPath}`);
console.log(`SQL saved to: ${sqlPath}`);

const typeCount = points.reduce((acc, p) => {
  acc[p.type] = (acc[p.type] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('\nDistribution by type:');
for (const [type, count] of Object.entries(typeCount)) {
  console.log(`  ${type}: ${count}`);
}

const floorCount = points.reduce((acc, p) => {
  acc[p.floor] = (acc[p.floor] || 0) + 1;
  return acc;
}, {} as Record<number, number>);

console.log('\nDistribution by floor:');
for (const [floor, count] of Object.entries(floorCount).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  Floor ${floor}: ${count}`);
}
