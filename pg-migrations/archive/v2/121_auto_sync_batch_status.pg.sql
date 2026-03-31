-- Migration: 121_auto_sync_batch_status
-- Description: 自动同步 batch_tasks 状态与子任务状态
-- Created: 2025-12-29

-- ============================================================================
-- 1. 创建函数：更新 batch_tasks 统计信息
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_batch_task_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_batch_id UUID;
    v_completed_count INTEGER;
    v_failed_count INTEGER;
    v_running_count INTEGER;
    v_pending_count INTEGER;
    v_new_status TEXT;
BEGIN
    -- 获取 batch_id（支持 INSERT、UPDATE、DELETE）
    IF TG_OP = 'DELETE' THEN
        v_batch_id := OLD.batch_id;
    ELSE
        v_batch_id := NEW.batch_id;
    END IF;

    -- 如果没有 batch_id，跳过
    IF v_batch_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- 统计子任务状态
    SELECT
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed'),
        COUNT(*) FILTER (WHERE status = 'running'),
        COUNT(*) FILTER (WHERE status = 'pending')
    INTO v_completed_count, v_failed_count, v_running_count, v_pending_count
    FROM offer_tasks
    WHERE batch_id = v_batch_id;

    -- 根据子任务状态决定 batch 状态
    IF v_running_count > 0 OR v_pending_count > 0 THEN
        -- 仍有任务在运行或等待
        v_new_status := 'running';
    ELSIF v_completed_count > 0 AND v_failed_count = 0 THEN
        -- 全部成功
        v_new_status := 'completed';
    ELSIF v_completed_count = 0 AND v_failed_count > 0 THEN
        -- 全部失败
        v_new_status := 'failed';
    ELSE
        -- 部分成功部分失败
        v_new_status := 'partial';
    END IF;

    -- 更新 batch_tasks
    UPDATE batch_tasks
    SET
        status = v_new_status,
        completed_count = v_completed_count,
        failed_count = v_failed_count,
        completed_at = CASE
            WHEN v_new_status IN ('completed', 'partial', 'failed') THEN NOW()
            ELSE completed_at
        END,
        updated_at = NOW()
    WHERE id = v_batch_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. 创建触发器：在 offer_tasks 变更时自动同步
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_offer_tasks_sync_batch ON offer_tasks;

CREATE TRIGGER trigger_offer_tasks_sync_batch
AFTER INSERT OR UPDATE OF status ON offer_tasks
FOR EACH ROW
EXECUTE FUNCTION sync_batch_task_stats();

-- ============================================================================
-- 3. 创建函数：自动更新 cancelled_at 和 cancelled_by（当状态变为 cancelled 时）
-- 注意：PostgreSQL 的 offer_tasks 不支持 cancelled 状态，这里作为参考保留
-- ============================================================================

-- ============================================================================
-- 4. 验证触发器创建成功
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_offer_tasks_sync_batch'
    ) THEN
        RAISE NOTICE '✅ 触发器 trigger_offer_tasks_sync_batch 创建成功';
    ELSE
        RAISE EXCEPTION '❌ 触发器创建失败';
    END IF;
END $$;

-- ============================================================================
-- 5. 立即同步一次所有 running 状态的 batch（清理历史数据）
-- ============================================================================
DO $$
DECLARE
    v_batch_id UUID;
    v_completed_count INTEGER;
    v_failed_count INTEGER;
    v_running_count INTEGER;
    v_pending_count INTEGER;
    v_new_status TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_batch_id IN
        SELECT id FROM batch_tasks WHERE status = 'running'
    LOOP
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed'),
            COUNT(*) FILTER (WHERE status = 'failed'),
            COUNT(*) FILTER (WHERE status = 'running'),
            COUNT(*) FILTER (WHERE status = 'pending')
        INTO v_completed_count, v_failed_count, v_running_count, v_pending_count
        FROM offer_tasks
        WHERE batch_id = v_batch_id;

        IF v_running_count = 0 AND v_pending_count = 0 THEN
            IF v_completed_count > 0 AND v_failed_count = 0 THEN
                v_new_status := 'completed';
            ELSIF v_completed_count = 0 AND v_failed_count > 0 THEN
                v_new_status := 'failed';
            ELSE
                v_new_status := 'partial';
            END IF;

            UPDATE batch_tasks
            SET
                status = v_new_status,
                completed_count = v_completed_count,
                failed_count = v_failed_count,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = v_batch_id;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '🔄 已同步 % 个历史 batch 状态', v_count;
END $$;

COMMENT ON FUNCTION sync_batch_task_stats IS '自动同步 batch_tasks 状态与子任务状态';
COMMENT ON TRIGGER trigger_offer_tasks_sync_batch ON offer_tasks IS '在 offer_tasks 状态变更时自动更新 batch_tasks';
