# Google Ads API 集成代码补丁

**生成时间**: 2026-04-05 14:30 (Asia/Shanghai)
**仓库**: autobb
**分支**: feature/google-ads-shared-auth
**最新提交**: 577c06d

---

## 补丁说明

本补丁包含 Google Ads 共享授权配置系统所需的代码修改：

### 变更文件 (5 个)

1. **新增**: `src/app/api/admin/google-ads/users-for-binding/route.ts`
   - 获取可绑定用户列表 API
   - 仅 admin 可访问
   - 返回用户基本信息（不含敏感数据）

2. **修改**: `src/app/api/admin/google-ads/oauth-config/route.ts`
   - 添加管理员权限检查

3. **修改**: `src/app/api/admin/google-ads/oauth-config/[id]/route.ts`
   - 添加管理员权限检查

4. **修改**: `src/app/api/admin/google-ads/service-account/route.ts`
   - 添加管理员权限检查

5. **修改**: `src/app/api/admin/google-ads/service-account/[id]/route.ts`
   - 添加管理员权限检查

---

## 应用方法

```bash
cd /home/admin/openclaw/workspace/autobb

# 应用补丁
git apply patches/google-ads-api-integration-patch-2026-04-05-1430.patch

# 或手动复制文件
cp src/app/api/admin/google-ads/users-for-binding/route.ts <target>/src/app/api/admin/google-ads/users-for-binding/

# 提交变更
git add src/app/api/admin/google-ads/users-for-binding/
git commit -m "feat: Google Ads 共享授权 - 完善权限检查和用户绑定 API"
```

---

## 测试验证

```bash
# 测试用户列表 API（管理员）
curl -H "Cookie: auth_token=<admin_token>" \
  http://localhost:3000/api/admin/google-ads/users-for-binding

# 测试权限检查（非管理员应返回 401）
curl -H "Cookie: auth_token=<user_token>" \
  http://localhost:3000/api/admin/google-ads/oauth-config
```

---

## 相关文件

- 完整补丁：`patches/google-ads-api-integration-patch-2026-04-05-1430.patch`
- 检查报告：`patches/google-ads-cron-check-report-2026-04-05-1430.md`

---

**生成**: Cron Job `a442a652-b2d0-4380-93dc-c97844f6ab32`
