const button = document.getElementById('captureBtn')
const statusNode = document.getElementById('status')

function setStatus(message, type) {
  statusNode.textContent = message || ''
  statusNode.className = `status${type ? ` ${type}` : ''}`
}

button.addEventListener('click', async () => {
  button.disabled = true
  setStatus('正在读取 YeahPromos Cookie 并回传...', '')

  try {
    const result = await chrome.runtime.sendMessage({ type: 'capture_yp_session' })
    if (result && result.success) {
      const expiresAt = result.session?.expiresAt || '-'
      const masked = result.session?.maskedPhpSessionId || '-'
      setStatus(`回传成功\n会话: ${masked}\n到期: ${expiresAt}`, 'success')
    } else {
      setStatus(result?.error || '回传失败，请重试。', 'error')
    }
  } catch (error) {
    setStatus(error?.message || '回传失败，请重试。', 'error')
  } finally {
    button.disabled = false
  }
})
