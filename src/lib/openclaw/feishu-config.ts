import { getOpenclawSettingsMap, readSecretFile } from '@/lib/openclaw/settings'

export type OpenclawFeishuDocConfig = {
  appId?: string
  appSecret?: string
  domain?: string
  docFolderToken?: string
  docTitlePrefix?: string
  bitableAppToken?: string
  bitableTableId?: string
  bitableTableName?: string
}

function normalizeValue(value: string | null | undefined): string | undefined {
  const trimmed = (value || '').trim()
  return trimmed || undefined
}

export async function getOpenclawFeishuDocConfig(userId: number): Promise<OpenclawFeishuDocConfig> {
  const settingMap = await getOpenclawSettingsMap(userId)

  const appSecret = normalizeValue(settingMap.feishu_app_secret)
    || readSecretFile(settingMap.feishu_app_secret_file)

  return {
    appId: normalizeValue(settingMap.feishu_app_id),
    appSecret,
    domain: normalizeValue(settingMap.feishu_domain),
    docFolderToken: normalizeValue(settingMap.feishu_doc_folder_token),
    docTitlePrefix: normalizeValue(settingMap.feishu_doc_title_prefix),
    bitableAppToken: normalizeValue(settingMap.feishu_bitable_app_token),
    bitableTableId: normalizeValue(settingMap.feishu_bitable_table_id),
    bitableTableName: normalizeValue(settingMap.feishu_bitable_table_name),
  }
}
