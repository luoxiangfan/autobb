type ClickFarmTaskResponse = {
  data?: {
    id?: string | number
    status?: string
  } | null
}

type UrlSwapTaskResponse = {
  data?: {
    id?: string | number
    status?: string
  } | null
}

type TaskResolveResult = {
  editTaskId?: string | number
  infoMessage?: string
}

const CLICK_FARM_EDITABLE_STATUS = new Set(['pending', 'running', 'paused', 'stopped'])
const URL_SWAP_EDITABLE_STATUS = new Set(['enabled', 'disabled', 'error'])

function formatClickFarmStatus(status?: string): string {
  switch (status) {
    case 'pending':
      return '待开始'
    case 'running':
      return '运行中'
    case 'paused':
      return '已暂停'
    case 'stopped':
      return '已停止'
    case 'completed':
      return '已完成'
    default:
      return status || '未知'
  }
}

function formatUrlSwapStatus(status?: string): string {
  switch (status) {
    case 'enabled':
      return '已启用'
    case 'disabled':
      return '已禁用'
    case 'error':
      return '异常'
    case 'completed':
      return '已完成'
    default:
      return status || '未知'
  }
}

export async function resolveClickFarmTaskMode(offerId: number): Promise<TaskResolveResult> {
  const response = await fetch(`/api/offers/${offerId}/click-farm-task`, {
    credentials: 'include',
  })

  if (!response.ok) {
    return {}
  }

  const payload = (await response.json()) as ClickFarmTaskResponse
  const task = payload?.data
  if (!task) {
    return {}
  }

  if (CLICK_FARM_EDITABLE_STATUS.has(task.status || '')) {
    if (task.status === 'paused' || task.status === 'stopped') {
      return {
        editTaskId: task.id,
        infoMessage: `当前任务状态为 ${formatClickFarmStatus(task.status)}，可在弹窗中恢复或调整后重新启动。`,
      }
    }

    return {
      editTaskId: task.id,
    }
  }

  return {
    infoMessage: (
      `当前任务状态为 ${formatClickFarmStatus(task.status)}，已进入创建新任务。` +
      '如需继续当前任务，请前往补点击管理页面'
    ),
  }
}

export async function resolveUrlSwapTaskMode(offerId: number): Promise<TaskResolveResult> {
  const response = await fetch(`/api/offers/${offerId}/url-swap-task`, {
    credentials: 'include',
  })

  if (!response.ok) {
    return {}
  }

  const payload = (await response.json()) as UrlSwapTaskResponse
  const task = payload?.data
  if (!task) {
    return {}
  }

  if (URL_SWAP_EDITABLE_STATUS.has(task.status || '')) {
    if (task.status === 'disabled' || task.status === 'error') {
      return {
        editTaskId: task.id,
        infoMessage: `当前任务状态为 ${formatUrlSwapStatus(task.status)}，可在弹窗中调整配置后前往换链接管理启用。`,
      }
    }

    return {
      editTaskId: task.id,
    }
  }

  return {
    infoMessage: `当前任务状态为 ${formatUrlSwapStatus(task.status)}，已进入创建新任务。`,
  }
}
