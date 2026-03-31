import fs from 'fs'
import path from 'path'

describe('Migration 089 (SQLite) robustness', () => {
  it('includes defensive ADD COLUMNs for re-runs / schema drift', () => {
    const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '089_add_bucket_d_to_ad_creatives.sql')
    const content = fs.readFileSync(migrationPath, 'utf-8')

    expect(content).toContain("ALTER TABLE ad_creatives ADD COLUMN negative_keywords_match_type TEXT DEFAULT '{}';")
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN ad_strength_data TEXT DEFAULT NULL;')
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN path1 TEXT DEFAULT NULL;')
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN path2 TEXT DEFAULT NULL;')
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN keyword_bucket TEXT;')
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN keyword_pool_id INTEGER;')
    expect(content).toContain('ALTER TABLE ad_creatives ADD COLUMN bucket_intent TEXT;')
  })

  it("updates keyword_bucket CHECK to include 'D'", () => {
    const migrationPath = path.join(process.cwd(), 'migrations', 'archive', 'v2', '089_add_bucket_d_to_ad_creatives.sql')
    const content = fs.readFileSync(migrationPath, 'utf-8')

    expect(content).toContain("keyword_bucket IN ('A', 'B', 'C', 'D', 'S')")
  })
})
