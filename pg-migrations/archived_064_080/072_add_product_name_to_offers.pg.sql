-- Migration 072: 添加product_name字段到offers表 (PostgreSQL)
-- Created: 2025-12-11
-- Purpose: 修复代码与schema不一致问题，添加产品名称字段

-- PostgreSQL语法
ALTER TABLE offers ADD COLUMN IF NOT EXISTS product_name TEXT;

-- 注释说明
-- product_name: 产品名称，用于更精准的产品标识和展示
-- 与brand（品牌名）配合使用，例如：brand="Teslong", product_name="Inspection Camera"

-- 添加注释
COMMENT ON COLUMN offers.product_name IS '产品名称（与brand配合使用）';
