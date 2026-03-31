-- 新增：Offer创建/提取任务可选品牌名输入
-- 用途：独立站场景下，使用用户填写的品牌名进行Google搜索补充信息
ALTER TABLE offer_tasks ADD COLUMN brand_name TEXT;
