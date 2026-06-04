/// <reference types="vite/client" />

declare module '*.json' {
  const value: any;
  export default value;
}

declare module '../../config/floor_layout.json' {
  import type { FloorPlanConfig } from '../shared/types';
  const value: FloorPlanConfig;
  export default value;
}
