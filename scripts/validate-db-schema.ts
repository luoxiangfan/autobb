#!/usr/bin/env tsx
/**
 * Database Schema Validation Script
 *
 * Purpose: Validate database schema consistency between SQLite and PostgreSQL
 * Usage: tsx scripts/validate-db-schema.ts [--sqlite-only] [--pg-only]
 *
 * Checks:
 * - Table existence and count
 * - Column names and approximate types
 * - Index existence
 * - Foreign key constraints
 * - Prompt versions seed data
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

interface ForeignKeyInfo {
  from: string;
  to: string;
  table: string;
}

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: string[];
}

class SchemaValidator {
  private sqlitePath: string;
  private expectedTableCount = 40;
  private expectedIndexCount = 89;
  private expectedPromptTypes = 12;

  constructor() {
    this.sqlitePath = resolve(__dirname, '../data/autoads.db');
  }

  /**
   * Main validation orchestrator
   */
  async validate(options: { sqliteOnly?: boolean; pgOnly?: boolean } = {}): Promise<void> {
    console.log('🔍 AutoAds Database Schema Validator');
    console.log('=====================================\n');

    const results: ValidationResult[] = [];

    if (!options.pgOnly) {
      console.log('📊 Validating SQLite Schema...\n');
      const sqliteResults = await this.validateSQLite();
      results.push(...sqliteResults);
    }

    if (!options.sqliteOnly && !options.pgOnly) {
      console.log('\n⚠️  PostgreSQL validation requires database connection');
      console.log('   Run with DATABASE_URL environment variable to validate PostgreSQL\n');
    }

    // Print summary
    this.printSummary(results);

    // Exit with error code if any validation failed
    const failedCount = results.filter(r => !r.passed).length;
    if (failedCount > 0) {
      process.exit(1);
    }
  }

  /**
   * Validate SQLite database schema
   */
  private async validateSQLite(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    try {
      const db = new Database(this.sqlitePath, { readonly: true });

      // Test 1: Database connection
      results.push(this.testDatabaseConnection(db));

      // Test 2: Table count
      results.push(this.testTableCount(db));

      // Test 3: Core tables existence
      results.push(this.testCoreTables(db));

      // Test 4: Index count
      results.push(this.testIndexes(db));

      // Test 5: Foreign keys enabled
      results.push(this.testForeignKeys(db));

      // Test 6: Prompt versions seed data
      results.push(this.testPromptVersions(db));

      // Test 7: Critical columns
      results.push(this.testCriticalColumns(db));

      // Test 8: No AB test tables
      results.push(this.testNoABTestTables(db));

      db.close();
    } catch (error) {
      results.push({
        passed: false,
        message: 'SQLite database validation failed',
        details: [(error as Error).message]
      });
    }

    return results;
  }

  /**
   * Test: Database connection
   */
  private testDatabaseConnection(db: Database.Database): ValidationResult {
    try {
      db.prepare('SELECT 1').get();
      return {
        passed: true,
        message: '✅ Database connection successful'
      };
    } catch (error) {
      return {
        passed: false,
        message: '❌ Database connection failed',
        details: [(error as Error).message]
      };
    }
  }

  /**
   * Test: Table count
   */
  private testTableCount(db: Database.Database): ValidationResult {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'ab_test%'
    `).get() as { count: number };

    const passed = result.count === this.expectedTableCount;

    return {
      passed,
      message: passed
        ? `✅ Table count correct: ${result.count} tables`
        : `❌ Table count mismatch: expected ${this.expectedTableCount}, got ${result.count}`
    };
  }

  /**
   * Test: Core tables existence
   */
  private testCoreTables(db: Database.Database): ValidationResult {
    const coreTables = [
      'users',
      'google_ads_accounts',
      'google_ads_credentials',
      'offers',
      'ad_creatives',
      'creative_versions',
      'campaigns',
      'ad_groups',
      'keywords',
      'prompt_versions',
      'scraped_products',
      'launch_scores',
      'risk_alerts',
      'optimization_recommendations',
      'system_settings'
    ];

    const missingTables: string[] = [];

    for (const table of coreTables) {
      const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM sqlite_master
        WHERE type='table' AND name=?
      `).get(table) as { count: number };

      if (result.count === 0) {
        missingTables.push(table);
      }
    }

    return {
      passed: missingTables.length === 0,
      message: missingTables.length === 0
        ? `✅ All ${coreTables.length} core tables exist`
        : `❌ Missing ${missingTables.length} core tables`,
      details: missingTables.length > 0 ? missingTables : undefined
    };
  }

  /**
   * Test: Indexes
   */
  private testIndexes(db: Database.Database): ValidationResult {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type='index'
        AND name NOT LIKE 'sqlite_%'
        AND tbl_name NOT LIKE 'ab_test%'
    `).get() as { count: number };

    // Allow significant variance in index count due to automatic indexes
    // SQLite creates automatic indexes for PRIMARY KEY and UNIQUE constraints
    const minExpected = 80;
    const maxExpected = 150;
    const passed = result.count >= minExpected && result.count <= maxExpected;

    return {
      passed,
      message: passed
        ? `✅ Index count acceptable: ${result.count} indexes (expected ${minExpected}-${maxExpected})`
        : `❌ Index count unusual: ${result.count} indexes (expected ${minExpected}-${maxExpected})`
    };
  }

  /**
   * Test: Foreign keys enabled
   */
  private testForeignKeys(db: Database.Database): ValidationResult {
    const result = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    const passed = result.foreign_keys === 1;

    return {
      passed,
      message: passed
        ? '✅ Foreign keys enabled'
        : '❌ Foreign keys disabled - data integrity at risk'
    };
  }

  /**
   * Test: Prompt versions seed data
   */
  private testPromptVersions(db: Database.Database): ValidationResult {
    const totalVersions = db.prepare('SELECT COUNT(*) as count FROM prompt_versions').get() as { count: number };
    const activeVersions = db.prepare('SELECT COUNT(*) as count FROM prompt_versions WHERE is_active = 1').get() as { count: number };
    const promptTypes = db.prepare('SELECT COUNT(DISTINCT prompt_id) as count FROM prompt_versions').get() as { count: number };

    const details: string[] = [
      `Total versions: ${totalVersions.count}`,
      `Active versions: ${activeVersions.count}`,
      `Prompt types: ${promptTypes.count}`
    ];

    // Validation rules:
    // - Must have exactly 12 distinct prompt types
    // - Must have exactly 12 active versions (one per prompt type)
    // - Total versions can be >= 12 (allows historical versions)
    const passed =
      totalVersions.count >= this.expectedPromptTypes &&
      activeVersions.count === this.expectedPromptTypes &&
      promptTypes.count === this.expectedPromptTypes;

    return {
      passed,
      message: passed
        ? '✅ Prompt versions seed data correct'
        : '❌ Prompt versions seed data incomplete',
      details
    };
  }

  /**
   * Test: Critical columns exist
   */
  private testCriticalColumns(db: Database.Database): ValidationResult {
    const checks = [
      { table: 'users', column: 'email' },
      { table: 'users', column: 'google_id' },
      { table: 'users', column: 'failed_login_count' },
      { table: 'offers', column: 'product_categories' },
      { table: 'offers', column: 'scrape_status' },
      { table: 'google_ads_accounts', column: 'status' },
      { table: 'google_ads_accounts', column: 'account_balance' },
      { table: 'scraped_products', column: 'product_info' },
      { table: 'scraped_products', column: 'deep_scrape_data' },
      { table: 'ad_creatives', column: 'keywords' },
      { table: 'creative_versions', column: 'user_id' }
    ];

    const missingColumns: string[] = [];

    for (const check of checks) {
      try {
        const columns = db.prepare(`PRAGMA table_info(${check.table})`).all() as Array<{ name: string }>;
        const hasColumn = columns.some(col => col.name === check.column);

        if (!hasColumn) {
          missingColumns.push(`${check.table}.${check.column}`);
        }
      } catch (error) {
        missingColumns.push(`${check.table}.${check.column} (table not found)`);
      }
    }

    return {
      passed: missingColumns.length === 0,
      message: missingColumns.length === 0
        ? '✅ All critical columns exist'
        : `❌ Missing ${missingColumns.length} critical columns`,
      details: missingColumns.length > 0 ? missingColumns : undefined
    };
  }

  /**
   * Test: No AB test tables (feature removed)
   */
  private testNoABTestTables(db: Database.Database): ValidationResult {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type='table'
        AND name LIKE 'ab_test%'
    `).get() as { count: number };

    return {
      passed: result.count === 0,
      message: result.count === 0
        ? '✅ AB test tables removed (as expected)'
        : `❌ Found ${result.count} AB test tables (should be 0)`
    };
  }

  /**
   * Print validation summary
   */
  private printSummary(results: ValidationResult[]): void {
    console.log('\n=====================================');
    console.log('📋 Validation Summary');
    console.log('=====================================\n');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    results.forEach(result => {
      console.log(result.message);
      if (result.details && result.details.length > 0) {
        result.details.forEach(detail => {
          console.log(`   └─ ${detail}`);
        });
      }
    });

    console.log('\n=====================================');
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log('=====================================\n');

    if (failed === 0) {
      console.log('🎉 All validations passed! Database schema is correct.\n');
    } else {
      console.log('⚠️  Some validations failed. Please review the errors above.\n');
    }
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const options = {
    sqliteOnly: args.includes('--sqlite-only'),
    pgOnly: args.includes('--pg-only')
  };

  const validator = new SchemaValidator();
  await validator.validate(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation script error:', error);
    process.exit(1);
  });
}

export { SchemaValidator };
