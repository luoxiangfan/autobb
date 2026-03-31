#!/usr/bin/env python3
"""
Developer Token 诊断脚本
用于独立测试 Developer Token 是否有效
"""

from google.ads.googleads.client import GoogleAdsClient
import json
import tempfile
import os

def test_developer_token():
    print("=" * 60)
    print("Developer Token 诊断工具")
    print("=" * 60)

    # 配置信息（从数据库获取）
    print("\n请输入配置信息：")
    developer_token = input("Developer Token: ").strip()
    service_account_email = input("Service Account Email: ").strip()
    mcc_customer_id = input("MCC Customer ID (10位数字): ").strip()

    print("\n请粘贴 Service Account Private Key（输入 'END' 结束）:")
    private_key_lines = []
    while True:
        line = input()
        if line.strip() == 'END':
            break
        private_key_lines.append(line)
    private_key = '\n'.join(private_key_lines)

    # 验证输入
    print("\n" + "=" * 60)
    print("配置验证")
    print("=" * 60)
    print(f"✓ Developer Token 长度: {len(developer_token)} 字符")
    print(f"✓ Developer Token 前缀: {developer_token[:10]}...")
    print(f"✓ Service Account Email: {service_account_email}")
    print(f"✓ MCC Customer ID: {mcc_customer_id}")
    print(f"✓ Private Key 长度: {len(private_key)} 字符")

    if len(developer_token) < 20 or len(developer_token) > 35:
        print(f"\n⚠️  警告: Developer Token 长度异常 ({len(developer_token)} 字符)")
        print("   正常长度应为 22-30 字符")

    if len(mcc_customer_id) != 10 or not mcc_customer_id.isdigit():
        print(f"\n❌ 错误: MCC Customer ID 格式错误")
        print(f"   应为 10 位数字，当前: '{mcc_customer_id}'")
        return

    # 创建服务账号配置
    print("\n" + "=" * 60)
    print("创建 Google Ads 客户端")
    print("=" * 60)

    service_account_info = {
        "type": "service_account",
        "client_email": service_account_email,
        "private_key": private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    # 写入临时文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(service_account_info, f)
        json_key_file_path = f.name

    try:
        # 创建 Google Ads 客户端
        client = GoogleAdsClient.load_from_dict({
            "developer_token": developer_token,
            "use_proto_plus": True,
            "login_customer_id": mcc_customer_id,
            "json_key_file_path": json_key_file_path,
        })

        print("✓ Google Ads 客户端创建成功")

        # 测试 API 调用
        print("\n" + "=" * 60)
        print("测试 API 调用")
        print("=" * 60)

        print("正在调用 ListAccessibleCustomers...")
        customer_service = client.get_service("CustomerService")
        accessible_customers = customer_service.list_accessible_customers()

        resource_names = list(accessible_customers.resource_names)
        customer_ids = [rn.split('/')[-1] for rn in resource_names]

        print(f"\n✅ 成功! 可访问 {len(customer_ids)} 个账户")
        print(f"   账户 ID: {', '.join(customer_ids)}")

        print("\n" + "=" * 60)
        print("诊断结果: ✅ Developer Token 有效")
        print("=" * 60)
        print("\n如果应用中仍然报错，问题可能在于：")
        print("1. 数据库中的 Developer Token 与此处使用的不同")
        print("2. 应用代码在传递 Developer Token 时有问题")
        print("3. 应用使用的 Service Account 配置与此处不同")

    except Exception as e:
        print(f"\n❌ 错误: {e}")
        print("\n" + "=" * 60)
        print("诊断结果: ❌ Developer Token 无效或配置有误")
        print("=" * 60)

        error_str = str(e).lower()

        if "developer token is not valid" in error_str or "developer_token_invalid" in error_str:
            print("\n可能的原因:")
            print("1. Developer Token 字符串错误（复制时有遗漏或多余字符）")
            print("2. Developer Token 来自错误的 Google Ads 账户")
            print("3. Developer Token 已被撤销")
            print("4. Developer Token 未在正确的 MCC 账户中创建")
            print("\n建议操作:")
            print("1. 访问 https://ads.google.com/aw/apicenter")
            print(f"2. 确认当前账户是 MCC {mcc_customer_id}")
            print("3. 检查 Developer Token 状态（Active/Revoked）")
            print("4. 如需要，重新生成 Developer Token")

        elif "authentication" in error_str or "unauthenticated" in error_str:
            print("\n可能的原因:")
            print("1. Service Account 私钥错误")
            print("2. Service Account 未被添加到 Google Ads 账户")
            print("3. Service Account 权限不足")
            print("\n建议操作:")
            print("1. 检查 Service Account JSON 文件是否正确")
            print("2. 在 Google Ads UI 中添加服务账号:")
            print(f"   邮箱: {service_account_email}")
            print(f"   MCC 账户: {mcc_customer_id}")
            print("   权限: 标准访问或管理员")

        else:
            print("\n详细错误信息:")
            print(str(e))

    finally:
        # 清理临时文件
        try:
            os.unlink(json_key_file_path)
        except:
            pass

if __name__ == "__main__":
    try:
        test_developer_token()
    except KeyboardInterrupt:
        print("\n\n已取消")
    except Exception as e:
        print(f"\n\n未预期的错误: {e}")
        import traceback
        traceback.print_exc()
