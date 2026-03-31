#!/usr/bin/env python3
"""
测试 Python Google Ads Service
"""
import requests
import json

# 测试配置（使用示例数据）
SERVICE_URL = "http://localhost:8001"

# 模拟服务账号配置
service_account = {
    "email": "test@example.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\ntest_key\n-----END PRIVATE KEY-----",
    "developer_token": "test_token",
    "login_customer_id": "1234567890"
}

def test_health():
    """测试健康检查"""
    print("Testing /health endpoint...")
    response = requests.get(f"{SERVICE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print()

def test_keyword_historical_metrics():
    """测试关键词历史数据 API"""
    print("Testing /api/keyword-planner/historical-metrics endpoint...")
    payload = {
        "service_account": service_account,
        "customer_id": "1234567890",
        "keywords": ["test keyword"],
        "language": "languageConstants/1000",
        "geo_target_constants": ["geoTargetConstants/2840"]
    }

    try:
        response = requests.post(
            f"{SERVICE_URL}/api/keyword-planner/historical-metrics",
            json=payload
        )
        print(f"Status: {response.status_code}")
        if response.status_code == 500:
            print(f"Error (expected with test credentials): {response.json()}")
        else:
            print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Error: {e}")
    print()

if __name__ == "__main__":
    test_health()
    test_keyword_historical_metrics()
    print("✅ Python service is running and responding to requests")
