-- 智能楼宇能源管理系统 - 数据库初始化脚本

-- 创建数据库（如需要）
-- CREATE DATABASE energy_management;

-- 连接到数据库
-- \c energy_management

-- 计量点表
CREATE TABLE IF NOT EXISTS meter_points (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('electricity', 'water', 'gas', 'cooling')),
    floor INTEGER NOT NULL,
    x DECIMAL(10, 2) NOT NULL,
    y DECIMAL(10, 2) NOT NULL,
    width DECIMAL(10, 2) NOT NULL DEFAULT 40,
    height DECIMAL(10, 2) NOT NULL DEFAULT 40,
    rated_power DECIMAL(12, 4),
    historical_average DECIMAL(12, 4) NOT NULL DEFAULT 0,
    location VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meter_points_type ON meter_points(type);
CREATE INDEX IF NOT EXISTS idx_meter_points_floor ON meter_points(floor);

-- 能耗数据表（按时间分区）
CREATE TABLE IF NOT EXISTS energy_data (
    id BIGSERIAL,
    meter_point_id VARCHAR(50) NOT NULL REFERENCES meter_points(id),
    timestamp TIMESTAMP NOT NULL,
    value DECIMAL(12, 4) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    power_factor DECIMAL(5, 4),
    transformer_load DECIMAL(5, 4),
    co2_level INTEGER,
    occupancy_count INTEGER,
    indoor_temp DECIMAL(5, 2),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 自动创建分区的函数
CREATE OR REPLACE FUNCTION create_energy_partition(target_date DATE)
RETURNS VOID AS $$
DECLARE
    year INTEGER := EXTRACT(YEAR FROM target_date);
    month INTEGER := EXTRACT(MONTH FROM target_date);
    partition_name VARCHAR(50);
    start_date DATE;
    end_date DATE;
BEGIN
    start_date := MAKE_DATE(year, month, 1);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'energy_data_' || year || '_' || LPAD(month::TEXT, 2, '0');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF energy_data
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
    
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%I_meter_time 
         ON %I(meter_point_id, timestamp DESC)',
        partition_name, partition_name
    );
    
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%I_timestamp 
         ON %I(timestamp DESC)',
        partition_name, partition_name
    );
    
    RAISE NOTICE 'Partition % created', partition_name;
END;
$$ LANGUAGE plpgsql;

-- 创建未来N个月分区的函数
CREATE OR REPLACE FUNCTION create_future_partitions(months_ahead INTEGER DEFAULT 3)
RETURNS VOID AS $$
DECLARE
    i INTEGER;
    current_month DATE;
BEGIN
    current_month := DATE_TRUNC('month', CURRENT_DATE);
    FOR i IN 0..months_ahead LOOP
        PERFORM create_energy_partition(current_month + (i || ' months')::INTERVAL);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 初始化未来3个月的分区
SELECT create_future_partitions(3);

CREATE INDEX IF NOT EXISTS idx_energy_data_meter_time ON energy_data(meter_point_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_energy_data_timestamp ON energy_data(timestamp DESC);

-- 启用自动VACUUM（确保PostgreSQL配置正确）
ALTER TABLE energy_data SET (autovacuum_enabled = true);
ALTER TABLE energy_data SET (autovacuum_vacuum_scale_factor = 0.1);
ALTER TABLE energy_data SET (autovacuum_analyze_scale_factor = 0.05);

-- 告警表
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(30) NOT NULL CHECK (type IN ('abnormal_usage', 'power_factor', 'transformer_overload')),
    meter_point_id VARCHAR(50) NOT NULL REFERENCES meter_points(id),
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('warning', 'critical')),
    message TEXT NOT NULL,
    value DECIMAL(12, 4) NOT NULL,
    threshold DECIMAL(12, 4) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_meter ON alerts(meter_point_id);
CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);

-- 电价配置表
CREATE TABLE IF NOT EXISTS pricing_tiers (
    id VARCHAR(50) PRIMARY KEY,
    period VARCHAR(10) NOT NULL CHECK (period IN ('peak', 'flat', 'valley')),
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    price DECIMAL(10, 4) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 空调控制策略表
CREATE TABLE IF NOT EXISTS ac_control_strategy (
    id SERIAL PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    peak_temp_adjustment DECIMAL(4, 1) NOT NULL DEFAULT 2.0,
    normal_set_point DECIMAL(4, 1) NOT NULL DEFAULT 24.0,
    min_set_point DECIMAL(4, 1) NOT NULL DEFAULT 20.0,
    max_set_point DECIMAL(4, 1) NOT NULL DEFAULT 28.0,
    co2_threshold INTEGER NOT NULL DEFAULT 1000,
    occupancy_threshold INTEGER NOT NULL DEFAULT 80,
    temp_limit_high DECIMAL(4, 1) NOT NULL DEFAULT 26.0,
    co2_constraint_enabled BOOLEAN DEFAULT TRUE,
    occupancy_constraint_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 初始化默认电价配置
INSERT INTO pricing_tiers (id, period, start_time, end_time, price) VALUES
('peak_1', 'peak', '08:00', '12:00', 1.25),
('peak_2', 'peak', '17:00', '21:00', 1.25),
('flat_1', 'flat', '06:00', '08:00', 0.75),
('flat_2', 'flat', '12:00', '17:00', 0.75),
('flat_3', 'flat', '21:00', '23:00', 0.75),
('valley_1', 'valley', '23:00', '06:00', 0.35)
ON CONFLICT (id) DO NOTHING;

-- 初始化默认空调控制策略
INSERT INTO ac_control_strategy (enabled, peak_temp_adjustment, normal_set_point, min_set_point, max_set_point, 
                                  co2_threshold, occupancy_threshold, temp_limit_high, co2_constraint_enabled, occupancy_constraint_enabled)
VALUES (TRUE, 2.0, 24.0, 20.0, 28.0, 1000, 80, 26.0, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 计量点配置数据将通过 config/meter_points.json 导入
