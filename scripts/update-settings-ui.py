#!/usr/bin/env python3
"""
替换设置页面中的API访问级别UI部分
"""

import re

# 读取文件
with open('src/app/(app)/settings/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 定义要替换的旧内容的正则模式（匹配从注释到结束的整个块）
old_pattern = r'{/\* API 访问级别配置 \*/}.*?{/\* 认证方式选择 \*/}'

# 新的内容
new_content = '''{/* API 访问级别显示（自动检测） */}
                    {googleAdsCredentialStatus?.hasCredentials && (
                      <div className="border-t pt-6">
                        <div className="mb-4">
                          <Label className="label-text mb-2 block">Google Ads API 访问级别</Label>
                          <p className="text-sm text-gray-600 mb-3">
                            系统会自动检测您的 Developer Token 权限级别，并据此显示每日API调用次数上限
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Test Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'test'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Test Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'test' && (
                                <CheckCircle2 className="w-5 h-5 text-red-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">0 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              仅限测试账号，需升级权限
                            </div>
                          </div>

                          {/* Explorer Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'explorer'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Explorer Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'explorer' && (
                                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">2,880 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              默认权限级别
                            </div>
                          </div>

                          {/* Basic Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'basic'
                              ? 'border-green-500 bg-green-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Basic Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'basic' && (
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">15,000 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              生产环境推荐
                            </div>
                          </div>
                        </div>

                        {/* 提示信息 */}
                        {googleAdsCredentialStatus.apiAccessLevel === 'test' && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                              <div className="text-xs text-red-700">
                                <p className="font-medium mb-1">⚠️ 当前为测试权限</p>
                                <p>您的 Developer Token 仅限测试账号使用。访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-800">Google Ads API Center</a> 申请升级到 Basic 或 Standard 权限。</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="flex items-start gap-2">
                            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="text-xs text-blue-700">
                              <p className="font-medium mb-1">🔍 自动检测说明</p>
                              <p>系统会在验证凭证或API调用时自动检测您的访问级别。如果权限发生变化（如从 Test 升级到 Basic），系统会自动更新。</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 认证方式选择 */}'''

# 执行替换（使用DOTALL标志使.匹配换行符）
new_file_content = re.sub(old_pattern, new_content, content, flags=re.DOTALL)

# 检查是否成功替换
if new_file_content == content:
    print("❌ 未找到匹配的内容，替换失败")
    exit(1)

# 写回文件
with open('src/app/(app)/settings/page.tsx', 'w', encoding='utf-8') as f:
    f.write(new_file_content)

print("✅ 成功替换API访问级别UI部分")
