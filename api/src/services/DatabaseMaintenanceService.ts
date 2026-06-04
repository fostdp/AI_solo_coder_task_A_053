import pool from '../config/database';
import cron from 'node-cron';

export interface RetentionPolicy {
  enabled: boolean;
  retentionDays: number;
  vacuumSchedule: string;
  partitionCreationMonths: number;
}

export class DatabaseMaintenanceService {
  private retentionPolicy: RetentionPolicy = {
    enabled: true,
    retentionDays: 90,
    vacuumSchedule: '0 2 * * *',
    partitionCreationMonths: 3,
  };

  private vacuumJob: cron.ScheduledTask | null = null;
  private partitionJob: cron.ScheduledTask | null = null;
  private retentionJob: cron.ScheduledTask | null = null;

  async init() {
    console.log('🔧 Initializing database maintenance service...');

    try {
      await this.loadRetentionPolicy();
      await this.ensurePartitions();
      await this.ensureRetentionPolicyTable();
      
      this.scheduleJobs();
      
      console.log('✅ Database maintenance service initialized');
      console.log(`   - Data retention: ${this.retentionPolicy.retentionDays} days`);
      console.log(`   - Pre-create partitions: ${this.retentionPolicy.partitionCreationMonths} months ahead`);
      console.log(`   - VACUUM schedule: ${this.retentionPolicy.vacuumSchedule}`);
    } catch (err) {
      console.error('❌ Failed to initialize database maintenance:', err);
    }
  }

  private async loadRetentionPolicy() {
    try {
      const result = await pool.query(`
        SELECT config_value FROM system_config 
        WHERE config_key = 'retention_policy'
      `);
      
      if (result.rows.length > 0) {
        this.retentionPolicy = { ...this.retentionPolicy, ...result.rows[0].config_value };
      }
    } catch (err) {
      console.log('Using default retention policy');
    }
  }

  private async ensureRetentionPolicyTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        config_key VARCHAR(100) PRIMARY KEY,
        config_value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      INSERT INTO system_config (config_key, config_value)
      VALUES ('retention_policy', $1::JSONB)
      ON CONFLICT (config_key) DO NOTHING
    `, [JSON.stringify(this.retentionPolicy)]);
  }

  async ensurePartitions(): Promise<void> {
    const now = new Date();
    const monthsAhead = this.retentionPolicy.partitionCreationMonths;
    
    console.log(`📋 Ensuring partitions for ${monthsAhead} months ahead...`);

    for (let i = 0; i <= monthsAhead; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const nextMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
      
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const nextYear = nextMonth.getFullYear();
      const nextMonthStr = String(nextMonth.getMonth() + 1).padStart(2, '0');
      
      const partitionName = `energy_data_${year}_${month}`;
      const startDate = `${year}-${month}-01`;
      const endDate = `${nextYear}-${nextMonthStr}-01`;

      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF energy_data
          FOR VALUES FROM ('${startDate}') TO ('${endDate}')
        `);
        
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_${partitionName}_meter_time 
          ON ${partitionName}(meter_point_id, timestamp DESC)
        `);
        
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_${partitionName}_timestamp 
          ON ${partitionName}(timestamp DESC)
        `);

        console.log(`   ✅ Partition ${partitionName} ready (${startDate} to ${endDate})`);
      } catch (err) {
        console.error(`   ❌ Failed to create partition ${partitionName}:`, err);
      }
    }
  }

  async runVacuum(): Promise<void> {
    console.log('🧹 Starting VACUUM ANALYZE...');
    const startTime = Date.now();

    const tables = ['energy_data', 'alerts', 'meter_points'];
    
    for (const table of tables) {
      try {
        const tableStart = Date.now();
        await pool.query(`VACUUM ANALYZE ${table}`);
        const duration = ((Date.now() - tableStart) / 1000).toFixed(1);
        console.log(`   ✅ VACUUM ANALYZE ${table} completed in ${duration}s`);
      } catch (err) {
        console.error(`   ❌ VACUUM ANALYZE ${table} failed:`, err);
      }
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ VACUUM ANALYZE completed in ${totalDuration}s`);
  }

  async purgeOldData(): Promise<void> {
    if (!this.retentionPolicy.enabled) {
      console.log('⏭️  Data retention disabled, skipping purge');
      return;
    }

    const retentionDays = this.retentionPolicy.retentionDays;
    console.log(`🗑️  Purging data older than ${retentionDays} days...`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
      const result = await pool.query(`
        DELETE FROM energy_data 
        WHERE timestamp < $1
        RETURNING id
      `, [cutoffDate]);

      console.log(`   ✅ Purged ${result.rowCount} old records`);
    } catch (err) {
      console.error('   ❌ Failed to purge old data:', err);
    }

    try {
      const alertResult = await pool.query(`
        DELETE FROM alerts 
        WHERE acknowledged = true 
          AND created_at < $1
        RETURNING id
      `, [cutoffDate]);

      if (alertResult.rowCount && alertResult.rowCount > 0) {
        console.log(`   ✅ Purged ${alertResult.rowCount} old acknowledged alerts`);
      }
    } catch (err) {
      console.error('   ❌ Failed to purge old alerts:', err);
    }
  }

  async dropOldPartitions(): Promise<void> {
    if (!this.retentionPolicy.enabled) return;

    const retentionDays = this.retentionPolicy.retentionDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const cutoffYear = cutoffDate.getFullYear();
    const cutoffMonth = cutoffDate.getMonth();

    try {
      const result = await pool.query(`
        SELECT relname FROM pg_class 
        WHERE relname LIKE 'energy_data_%' 
          AND relkind = 'r'
        ORDER BY relname
      `);

      for (const row of result.rows) {
        const match = row.relname.match(/energy_data_(\d{4})_(\d{2})/);
        if (match) {
          const year = parseInt(match[1]);
          const month = parseInt(match[2]) - 1;
          
          if (year < cutoffYear || (year === cutoffYear && month < cutoffMonth)) {
            try {
              await pool.query(`DROP TABLE IF EXISTS ${row.relname}`);
              console.log(`   ✅ Dropped old partition: ${row.relname}`);
            } catch (err) {
              console.error(`   ❌ Failed to drop ${row.relname}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error('❌ Failed to drop old partitions:', err);
    }
  }

  async getMaintenanceStatus() {
    const result = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autoanalyze,
        last_analyze
      FROM pg_stat_user_tables 
      WHERE tablename LIKE 'energy_data%' OR tablename IN ('alerts', 'meter_points')
      ORDER BY tablename
    `);

    const partitionResult = await pool.query(`
      SELECT 
        c.relname as partition_name,
        pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
        pg_size_pretty(pg_indexes_size(c.oid)) as index_size
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'energy_data'
      ORDER BY c.relname
    `);

    return {
      retentionPolicy: this.retentionPolicy,
      tableStats: result.rows,
      partitions: partitionResult.rows,
    };
  }

  private scheduleJobs() {
    this.vacuumJob = cron.schedule(this.retentionPolicy.vacuumSchedule, async () => {
      console.log('\n⏰ Scheduled VACUUM job starting...');
      await this.runVacuum();
    });

    this.partitionJob = cron.schedule('0 0 1 * *', async () => {
      console.log('\n⏰ Scheduled partition creation job starting...');
      await this.ensurePartitions();
    });

    this.retentionJob = cron.schedule('0 3 * * 0', async () => {
      console.log('\n⏰ Scheduled retention job starting...');
      await this.purgeOldData();
      await this.dropOldPartitions();
    });

    console.log('📅 Maintenance jobs scheduled:');
    console.log('   - VACUUM ANALYZE: Daily at 02:00');
    console.log('   - Partition creation: Monthly on 1st at 00:00');
    console.log('   - Data retention: Weekly on Sunday at 03:00');
  }

  stop() {
    if (this.vacuumJob) this.vacuumJob.stop();
    if (this.partitionJob) this.partitionJob.stop();
    if (this.retentionJob) this.retentionJob.stop();
    console.log('🛑 Database maintenance service stopped');
  }
}

export default new DatabaseMaintenanceService();
