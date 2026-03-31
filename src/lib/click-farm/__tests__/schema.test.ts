/**
 * Click Farm Database Schema 集成测试
 * src/lib/click-farm/__tests__/schema.test.ts
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('ClickFarm Database Schema', () => {
  describe('SQLite Migration File', () => {
    it('迁移文件118应该存在', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('SQLite迁移文件应该包含正确的表名', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('CREATE TABLE IF NOT EXISTS click_farm_tasks');
      expect(content).toContain('click_farm_tasks');
    });

    it('SQLite迁移文件应该包含所有必要字段', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      // 任务配置字段
      expect(content).toContain('daily_click_count');
      expect(content).toContain('start_time');
      expect(content).toContain('end_time');
      expect(content).toContain('duration_days');
      expect(content).toContain('hourly_distribution');
      expect(content).toContain('scheduled_start_date');

      // 状态管理字段
      expect(content).toContain('status');
      expect(content).toContain('pause_reason');
      expect(content).toContain('pause_message');
      expect(content).toContain('paused_at');

      // 统计字段
      expect(content).toContain('total_clicks');
      expect(content).toContain('success_clicks');
      expect(content).toContain('failed_clicks');
      expect(content).toContain('progress');

      // 历史数据字段
      expect(content).toContain('daily_history');

      // 时区字段
      expect(content).toContain('timezone');

      // 软删除字段
      expect(content).toContain('is_deleted');
      expect(content).toContain('deleted_at');

      // 时间戳字段
      expect(content).toContain('started_at');
      expect(content).toContain('completed_at');
      expect(content).toContain('next_run_at');
      expect(content).toContain('created_at');
      expect(content).toContain('updated_at');
    });

    it('SQLite迁移文件应该包含所有必要的索引', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('idx_cft_user_status');
      expect(content).toContain('idx_cft_next_run');
      expect(content).toContain('idx_cft_created');
      expect(content).toContain('idx_cft_offer');
      expect(content).toContain('idx_cft_scheduled_start');
      expect(content).toContain('idx_cft_timezone');
    });

    it('SQLite迁移文件应该使用正确的SQLite语法', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      // 使用INTEGER作为BOOLEAN
      expect(content).toContain('INTEGER DEFAULT 0');

      // 使用TEXT作为时间戳
      expect(content).toContain('TEXT DEFAULT (datetime');

      // 使用DATE函数
      expect(content).toContain('DATE');

      // 使用randomblob生成ID
      expect(content).toContain('randomblob');
    });

    it('SQLite迁移文件应该包含hourly_breakdown注释', () => {
      const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('hourly_breakdown');
    });
  });

  describe('PostgreSQL Migration File', () => {
    it('PostgreSQL迁移文件118应该存在', () => {
      const migrationPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('PostgreSQL迁移文件应该包含正确的表名', () => {
      const migrationPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('CREATE TABLE IF NOT EXISTS click_farm_tasks');
    });

    it('PostgreSQL迁移文件应该使用正确的PostgreSQL语法', () => {
      const migrationPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      // 使用UUID
      expect(content).toContain('UUID PRIMARY KEY');
      expect(content).toContain('gen_random_uuid');

      // 使用BOOLEAN
      expect(content).toContain('BOOLEAN DEFAULT false');

      // 使用TIMESTAMP
      expect(content).toContain('TIMESTAMP');

      // 使用JSONB
      expect(content).toContain('JSONB');

      // 使用NOW()和CURRENT_DATE
      expect(content).toContain('NOW()');
      expect(content).toContain('CURRENT_DATE');
    });

    it('PostgreSQL迁移文件应该使用外键约束语法', () => {
      const migrationPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('CONSTRAINT');
      expect(content).toContain('FOREIGN KEY');
      expect(content).toContain('ON DELETE CASCADE');
    });

    it('PostgreSQL迁移文件应该包含GIN索引用于JSONB', () => {
      const migrationPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      const content = fs.readFileSync(migrationPath, 'utf-8');

      expect(content).toContain('USING GIN');
      expect(content).toContain('daily_history');
    });
  });

  describe('SQLite vs PostgreSQL Differences', () => {
    it('两个迁移文件应该包含相同的业务逻辑字段', () => {
      const sqlitePath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const pgPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');

      const sqliteContent = fs.readFileSync(sqlitePath, 'utf-8');
      const pgContent = fs.readFileSync(pgPath, 'utf-8');

      // 两个文件都应该有这些核心字段
      const coreFields = [
        'daily_click_count',
        'start_time',
        'end_time',
        'duration_days',
        'hourly_distribution',
        'scheduled_start_date',
        'status',
        'total_clicks',
        'success_clicks',
        'failed_clicks',
        'daily_history',
        'timezone',
        'is_deleted',
        'created_at',
        'updated_at'
      ];

      coreFields.forEach(field => {
        expect(sqliteContent).toContain(field);
        expect(pgContent).toContain(field);
      });
    });

    it('PostgreSQL文件不应该包含SQLite特定语法', () => {
      const pgPath = path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '118_click_farm_tasks.pg.sql');
      const content = fs.readFileSync(pgPath, 'utf-8');

      // PostgreSQL不应该使用randomblob
      expect(content).not.toContain('randomblob');

      // PostgreSQL不应该使用INTEGER作为BOOLEAN
      expect(content).not.toContain('INTEGER DEFAULT 0  -- SQLite使用INTEGER代替BOOLEAN');
    });

    it('SQLite文件不应该包含PostgreSQL特定语法', () => {
      const sqlitePath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '118_click_farm_tasks.sql');
      const content = fs.readFileSync(sqlitePath, 'utf-8');

      // SQLite不应该使用gen_random_uuid
      expect(content).not.toContain('gen_random_uuid');

      // SQLite不应该使用BOOLEAN类型声明
      expect(content).not.toContain('BOOLEAN DEFAULT false');
    });
  });
});
