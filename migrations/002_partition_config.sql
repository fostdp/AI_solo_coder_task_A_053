-- PostgreSQL分区配置和自动维护脚本
-- 智能楼宇能源管理系统

-- 创建数据保留策略配置表
CREATE TABLE IF NOT EXISTS data_retention_policy (
    id SERIAL PRIMARY KEY,
    retention_days INTEGER NOT NULL DEFAULT 90,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO data_retention_policy (retention_days, enabled)
VALUES (90, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 创建分区维护日志表
CREATE TABLE IF NOT EXISTS partition_maintenance_log (
    id BIGSERIAL PRIMARY KEY,
    operation VARCHAR(50) NOT NULL,
    partition_name VARCHAR(100),
    status VARCHAR(20) NOT NULL,
    message TEXT,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 自动删除过期分区的函数
CREATE OR REPLACE FUNCTION drop_old_partitions(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    cutoff_date DATE;
    partition_record RECORD;
    dropped_count INTEGER := 0;
    sql_query TEXT;
BEGIN
    cutoff_date := DATE_TRUNC('month', CURRENT_DATE - (retention_days || ' days')::INTERVAL);
    
    FOR partition_record IN
        SELECT nmsp_child.nspname AS schema_name,
               child.relname AS table_name
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class child ON pg_inherits.inhrelid = child.oid
        JOIN pg_namespace nmsp_child ON nmsp_child.oid = child.relnamespace
        WHERE parent.relname = 'energy_data'
          AND child.relname ~ '^energy_data_\d{4}_\d{2}$'
    LOOP
        DECLARE
            year_part INTEGER;
            month_part INTEGER;
            partition_date DATE;
        BEGIN
            year_part := SPLIT_PART(partition_record.table_name, '_', 3)::INTEGER;
            month_part := SPLIT_PART(partition_record.table_name, '_', 4)::INTEGER;
            partition_date := MAKE_DATE(year_part, month_part, 1);
            
            IF partition_date < cutoff_date THEN
                sql_query := format('DROP TABLE IF EXISTS %I.%I CASCADE', 
                                    partition_record.schema_name, 
                                    partition_record.table_name);
                
                EXECUTE sql_query;
                
                INSERT INTO partition_maintenance_log (operation, partition_name, status, message)
                VALUES ('DROP', partition_record.table_name, 'SUCCESS', 
                        'Partition dropped, older than ' || cutoff_date::TEXT);
                
                dropped_count := dropped_count + 1;
                
                RAISE NOTICE 'Dropped partition: %', partition_record.table_name;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO partition_maintenance_log (operation, partition_name, status, message)
            VALUES ('DROP', partition_record.table_name, 'FAILED', SQLERRM);
        END;
    END LOOP;
    
    RETURN dropped_count;
END;
$$ LANGUAGE plpgsql;

-- 综合分区维护函数
CREATE OR REPLACE FUNCTION maintain_partitions(
    create_months_ahead INTEGER DEFAULT 3,
    retention_days INTEGER DEFAULT 90
)
RETURNS TABLE (
    operation VARCHAR(50),
    count INTEGER,
    status VARCHAR(20)
) AS $$
DECLARE
    created_count INTEGER;
    dropped_count INTEGER;
BEGIN
    PERFORM create_future_partitions(create_months_ahead);
    GET DIAGNOSTICS created_count = ROW_COUNT;
    
    IF created_count IS NULL THEN
        created_count := 0;
    END IF;
    
    dropped_count := drop_old_partitions(retention_days);
    
    INSERT INTO partition_maintenance_log (operation, partition_name, status, message)
    VALUES ('MAINTENANCE', 'ALL', 'SUCCESS', 
            'Created ' || created_count || ' partitions, dropped ' || dropped_count || ' partitions');
    
    RETURN QUERY
        SELECT 'CREATE'::VARCHAR AS operation, created_count AS count, 'SUCCESS'::VARCHAR AS status
        UNION ALL
        SELECT 'DROP'::VARCHAR AS operation, dropped_count AS count, 'SUCCESS'::VARCHAR AS status;
END;
$$ LANGUAGE plpgsql;

-- 创建pg_cron扩展（如果可用）用于定时任务
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每天凌晨2点执行分区维护
SELECT cron.schedule(
    'partition-maintenance',
    '0 2 * * *',
    $$SELECT maintain_partitions(3, 90);$$
) WHERE EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
);

-- 每周日凌晨3点执行VACUUM ANALYZE
SELECT cron.schedule(
    'vacuum-analyze-energy-data',
    '0 3 * * 0',
    $$VACUUM ANALYZE energy_data;$$
) WHERE EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
);

-- 每小时执行一次轻量ANALYZE
SELECT cron.schedule(
    'analyze-energy-data-hourly',
    '0 * * * *',
    $$ANALYZE energy_data;$$
) WHERE EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
);

-- 数据清理函数 - 软删除旧数据
CREATE OR REPLACE FUNCTION purge_old_data(target_days INTEGER DEFAULT 90)
RETURNS BIGINT AS $$
DECLARE
    cutoff_date TIMESTAMP;
    deleted_count BIGINT;
BEGIN
    cutoff_date := CURRENT_TIMESTAMP - (target_days || ' days')::INTERVAL;
    
    WITH deleted AS (
        DELETE FROM energy_data
        WHERE timestamp < cutoff_date
        RETURNING 1
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    
    INSERT INTO partition_maintenance_log (operation, partition_name, status, message)
    VALUES ('PURGE', 'ALL', 'SUCCESS', 
            'Purged ' || deleted_count || ' records older than ' || cutoff_date::TEXT);
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 性能监控函数
CREATE OR REPLACE FUNCTION get_partition_stats()
RETURNS TABLE (
    partition_name VARCHAR(100),
    record_count BIGINT,
    size_bytes BIGINT,
    size_mb NUMERIC,
    min_timestamp TIMESTAMP,
    max_timestamp TIMESTAMP
) AS $$
DECLARE
    partition_rec RECORD;
BEGIN
    FOR partition_rec IN
        SELECT c.relname AS table_name
        FROM pg_inherits
        JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
        JOIN pg_class c ON pg_inherits.inhrelid = c.oid
        WHERE parent.relname = 'energy_data'
          AND c.relname ~ '^energy_data_\d{4}_\d{2}$'
        ORDER BY c.relname DESC
    LOOP
        RETURN QUERY EXECUTE format(
            'SELECT 
                %L::VARCHAR AS partition_name,
                COUNT(*) AS record_count,
                pg_relation_size(%L) AS size_bytes,
                ROUND(pg_relation_size(%L) / 1024.0 / 1024.0, 2) AS size_mb,
                MIN(timestamp) AS min_timestamp,
                MAX(timestamp) AS max_timestamp
            FROM %I',
            partition_rec.table_name,
            partition_rec.table_name,
            partition_rec.table_name,
            partition_rec.table_name
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 数据库大小统计函数
CREATE OR REPLACE FUNCTION get_database_size_stats()
RETURNS TABLE (
    table_name VARCHAR(100),
    record_count BIGINT,
    total_size_bytes BIGINT,
    total_size_mb NUMERIC,
    index_size_bytes BIGINT,
    index_size_mb NUMERIC,
    toast_size_bytes BIGINT,
    toast_size_mb NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.relname::VARCHAR AS table_name,
        c.reltuples::BIGINT AS record_count,
        pg_total_relation_size(c.oid) AS total_size_bytes,
        ROUND(pg_total_relation_size(c.oid) / 1024.0 / 1024.0, 2) AS total_size_mb,
        pg_indexes_size(c.oid) AS index_size_bytes,
        ROUND(pg_indexes_size(c.oid) / 1024.0 / 1024.0, 2) AS index_size_mb,
        pg_total_relation_size(c.reltoastrelid) AS toast_size_bytes,
        ROUND(pg_total_relation_size(c.reltoastrelid) / 1024.0 / 1024.0, 2) AS toast_size_mb
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
      AND c.relname IN ('energy_data', 'meter_points', 'alerts', 'pricing_tiers', 'ac_control_strategy')
    ORDER BY pg_total_relation_size(c.oid) DESC;
END;
$$ LANGUAGE plpgsql;

-- 初始化当前和未来3个月的分区
SELECT maintain_partitions(3, 90);

-- 创建告警表索引优化
CREATE INDEX IF NOT EXISTS idx_alerts_created_time ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type_severity ON alerts(type, severity);

-- 创建计量点数据汇总视图
CREATE OR REPLACE VIEW energy_data_hourly_summary AS
SELECT
    meter_point_id,
    DATE_TRUNC('hour', timestamp) AS hour,
    COUNT(*) AS record_count,
    SUM(value) AS total_value,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value
FROM energy_data
GROUP BY meter_point_id, DATE_TRUNC('hour', timestamp);

CREATE OR REPLACE VIEW energy_data_daily_summary AS
SELECT
    meter_point_id,
    DATE_TRUNC('day', timestamp) AS day,
    COUNT(*) AS record_count,
    SUM(value) AS total_value,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value
FROM energy_data
GROUP BY meter_point_id, DATE_TRUNC('day', timestamp);

-- 设置权限
GRANT ALL ON ALL TABLES IN SCHEMA public TO CURRENT_USER;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO CURRENT_USER;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO CURRENT_USER;
