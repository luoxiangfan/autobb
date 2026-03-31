"""
Google Ads API Service - 服务账号模式
处理所有需要服务账号认证的 Google Ads API 调用
"""
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional
from google.ads.googleads.client import GoogleAdsClient
from datetime import datetime, timezone
import contextvars
import logging
import json
import os
import sys
import tempfile
import time
import uuid
import unicodedata

request_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("request_id", default=None)
user_id_ctx: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar("user_id", default=None)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.requestId = request_id_ctx.get()
        record.userId = user_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "service": os.getenv("SERVICE_NAME") or "python-ads-service",
            "env": os.getenv("ENV") or os.getenv("APP_ENV") or os.getenv("NODE_ENV") or "development",
            "instanceId": os.getenv("HOSTNAME") or os.getenv("INSTANCE_ID"),
            "logger": record.name,
            "msg": record.getMessage(),
        }

        request_id = getattr(record, "requestId", None)
        if request_id:
            payload["requestId"] = request_id

        user_id = getattr(record, "userId", None)
        if user_id is not None:
            payload["userId"] = user_id

        for key in ("method", "path", "status", "durationMs"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value

        if record.exc_info:
            exc_type, exc, _tb = record.exc_info
            payload["err"] = {
                "name": getattr(exc_type, "__name__", "Exception"),
                "message": str(exc),
                "stack": self.formatException(record.exc_info),
            }

        return json.dumps(payload, ensure_ascii=False)


_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(JsonFormatter())
_handler.addFilter(ContextFilter())

_root = logging.getLogger()
_root.handlers = [_handler]
_root.setLevel(logging.INFO)

logger = logging.getLogger(__name__)

app = FastAPI(title="Google Ads Service Account API")

@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    user_id_header = request.headers.get("x-user-id")
    user_id = int(user_id_header) if user_id_header and user_id_header.isdigit() else None

    request_id_token = request_id_ctx.set(request_id)
    user_id_token = user_id_ctx.set(user_id)

    start = time.time()
    response = None
    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = int((time.time() - start) * 1000)

        if response is not None:
            try:
                response.headers["x-request-id"] = request_id
            except Exception:
                pass

        try:
            logger.info(
                "http_request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": getattr(response, "status_code", 500),
                    "durationMs": duration_ms,
                },
            )
        except Exception:
            pass

        request_id_ctx.reset(request_id_token)
        user_id_ctx.reset(user_id_token)


def format_customer_id(v: str) -> str:
    """统一格式化customer_id"""
    return v.replace("-", "").replace(" ", "")


def sanitize_keyword(keyword: str) -> str:
    """
    清理关键词，移除Google Ads不支持的特殊字符
    Google Ads关键词只支持: 字母(A-Z,a-z)、数字(0-9)、空格、下划线(_)、连字符(-)
    """
    import re
    # 只保留字母、数字、空格、下划线、连字符
    cleaned = re.sub(r'[^\w\s-]', '', keyword)
    # 清理多余的空格
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # 清理开头和结尾的连字符
    cleaned = cleaned.strip('-')
    return cleaned


PROHIBITED_AD_TEXT_REPLACEMENTS: Dict[str, str] = {
    # Google Ads policy: SYMBOLS (PROHIBITED) evidence: "±"
    "±": "+/-",
    # Google Ads policy: SYMBOLS (PROHIBITED) evidence: "~"
    "~": " ",
    "～": " ",
    # Google Ads policy: SYMBOLS (PROHIBITED) evidence: "；"
    "；": " ",
    # 与 Node.js 侧保持一致，统一清理常见装饰符号
    "★": " ",
    "☆": " ",
    "⭐": " ",
    "🌟": " ",
    "✨": " ",
    "©": " ",
    "®": " ",
    "™": " ",
    "•": " ",
    "●": " ",
    "◆": " ",
    "▪": " ",
    "→": " ",
    "←": " ",
    "↑": " ",
    "↓": " ",
    "✓": " ",
    "✔": " ",
    "✗": " ",
    "✘": " ",
    "❤": " ",
    "♥": " ",
    "♡": " ",
    "⚡": " ",
    "🔥": " ",
    "💎": " ",
    "👍": " ",
    "👎": " ",
    # quote-like symbols（线上多次触发 SYMBOLS）
    "\"": " ",
    "“": " ",
    "”": " ",
    "„": " ",
    "‟": " ",
    "«": " ",
    "»": " ",
    "‘": " ",
    "’": " ",
    # subscript digits（线上多次触发 SYMBOLS，如 ₄）
    "₀": " ",
    "₁": " ",
    "₂": " ",
    "₃": " ",
    "₄": " ",
    "₅": " ",
    "₆": " ",
    "₇": " ",
    "₈": " ",
    "₉": " ",
    # parentheses / pipe（与 Node.js 侧保持一致，避免 SYMBOLS 漏网）
    "(": " ",
    ")": " ",
    "|": " ",
}


PROHIBITED_AD_TEXT_CHARS = set(PROHIBITED_AD_TEXT_REPLACEMENTS.keys())


import re

DKI_PATTERN = re.compile(r"\{keyword:([^}]*)\}", re.IGNORECASE)
PRESERVED_UPPERCASE_TOKENS = {
    "AI", "AMD", "API", "ASUS", "BBC", "BMW", "CEO", "CFO", "CIA", "CNN", "CPU", "CPA", "CTO",
    "DELL", "DVD", "EU", "ESPN", "FBI", "GPS", "GPU", "HBO", "HDD", "HD", "HP", "IBM", "LCD",
    "LED", "LG", "MTV", "NASA", "NBA", "NFL", "NHL", "PPC", "RAM", "RGB", "ROI", "ROM", "SEO",
    "SSD", "TV", "UAE", "UHD", "UK", "USA", "USB", "US",
}


def has_excessive_capitalization(text: str) -> bool:
    letters = re.findall(r"[A-Za-z]", text or "")
    if len(letters) < 6:
        return False

    upper_count = len(re.findall(r"[A-Z]", text))
    if upper_count / len(letters) < 0.6:
        return False

    uppercase_words = re.findall(r"\b[A-Z]{2,}\b", text)
    return len(uppercase_words) >= 2


def to_title_case_word(word: str) -> str:
    lowered = (word or "").lower()
    return re.sub(r"(^|[-'])([a-z])", lambda m: f"{m.group(1)}{m.group(2).upper()}", lowered)


def sanitize_excessive_capitalization(text: str) -> str:
    if not has_excessive_capitalization(text):
        return text

    def replace_word(match: re.Match[str]) -> str:
        word = match.group(0)
        compact = re.sub(r"['&-]", "", word)
        if not compact or len(compact) <= 1:
            return word
        if compact in PRESERVED_UPPERCASE_TOKENS:
            return word
        return to_title_case_word(word)

    return re.sub(r"\b[A-Z][A-Z'&-]*\b", replace_word, text)


def ad_text_effective_length(text: str) -> int:
    """
    计算 Google Ads 文案的“有效长度”：
    - 对 DKI token（{KeyWord:DefaultText}）按 DefaultText 计数，不计 token 结构本身。
    """
    if not text:
        return 0

    total = 0
    last = 0
    for m in DKI_PATTERN.finditer(text):
        total += len(text[last:m.start()])
        total += len(m.group(1) or "")
        last = m.end()
    total += len(text[last:])
    return total


def sanitize_ad_text(text: str, *, max_len: Optional[int] = None) -> str:
    """
    轻量清理广告文案，避免触发 Google Ads 的 PROHIBITED policy topics（如 SYMBOLS）。
    - 尽量保留含义（例如 ± -> +/-）
    - 不做过度清理（广告文案允许标点、变音符等）
    """
    if text is None:
        return ""

    sanitized = str(text)
    for ch, repl in PROHIBITED_AD_TEXT_REPLACEMENTS.items():
        sanitized = sanitized.replace(ch, repl)

    # Normalize compatibility glyphs (e.g. 𝗔/𝟭) to plain forms.
    sanitized = unicodedata.normalize("NFKC", sanitized)

    # 统一空白字符（避免换行/制表符）
    sanitized = " ".join(sanitized.split()).strip()
    sanitized = sanitize_excessive_capitalization(sanitized)

    if max_len is not None and ad_text_effective_length(sanitized) > max_len:
        # 如果替换导致超长，尝试移除被替换字符以保持长度
        removed = str(text)
        for ch in PROHIBITED_AD_TEXT_REPLACEMENTS.keys():
            removed = removed.replace(ch, "")
        removed = unicodedata.normalize("NFKC", removed)
        removed = " ".join(removed.split()).strip()
        if ad_text_effective_length(removed) <= max_len:
            return removed
        raise ValueError(
            f"ad text exceeds max_len={max_len} after sanitization: "
            f"effective_len={ad_text_effective_length(sanitized)}, raw_len={len(sanitized)}"
        )

    return sanitized


def find_prohibited_ad_text_chars(text: str) -> List[str]:
    if not text:
        return []
    found = sorted({ch for ch in PROHIBITED_AD_TEXT_CHARS if ch in text})
    return found


def sanitize_rsa_path(path: str, *, max_len: int = 15) -> str:
    """
    清理 RSA Display Path（path1/path2）。
    - 移除已知会触发 SYMBOLS policy 的字符（如 ~）
    - 空白转为连字符，避免 API 参数错误
    - 截断到最大长度（Google Ads: 15）
    """
    if path is None:
        return ""
    cleaned = str(path)
    for ch in PROHIBITED_AD_TEXT_REPLACEMENTS.keys():
        cleaned = cleaned.replace(ch, "")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    cleaned = " ".join(cleaned.split()).strip()
    cleaned = sanitize_excessive_capitalization(cleaned)
    cleaned = re.sub(r"\s+", "-", cleaned).strip("-")
    return cleaned[:max_len].strip("-")


def sanitize_ad_extension_text(text: str, *, max_len: int) -> str:
    """
    扩展资产（Callout/Sitelink）文本清理：
    - 清理 Google Ads 禁用符号
    - 保留旧行为：超长时直接截断，不抛长度异常
    """
    sanitized = sanitize_ad_text(text)
    return sanitized[:max_len].strip()


def sanitize_final_url_suffix(value: Optional[str]) -> str:
    """
    清理 Final URL Suffix：
    - 去除会触发 policy 的符号（例如全角分号）
    - 移除空白，避免参数拼接异常
    """
    if value is None:
        return ""
    sanitized = sanitize_ad_text(value)
    return re.sub(r"\s+", "", sanitized).strip()


def validate_login_customer_id(v: str) -> str:
    """验证并格式化 login_customer_id"""
    # 记录原始值（调试用）
    logger.info(f"Validating login_customer_id: original='{v}'")
    # 移除空格和横杠
    formatted = v.replace(' ', '').replace('-', '')
    # 验证必须是10位数字
    if not formatted.isdigit() or len(formatted) != 10:
        logger.error(f"Invalid login_customer_id: original='{v}', formatted='{formatted}'")
        raise ValueError(f"login_customer_id must be a 10-digit number, got: '{v}' (formatted: '{formatted}')")
    logger.info(f"Validated login_customer_id: formatted='{formatted}'")
    return formatted


class ServiceAccountConfig(BaseModel):
    email: str
    private_key: str
    developer_token: str
    login_customer_id: str = Field(..., description="Must be a 10-digit number without dashes or spaces")
    user_id: Optional[int] = Field(None, description="User ID for logging and tracking")

    @field_validator("login_customer_id", mode="before")
    @classmethod
    def validate_login_customer_id(cls, v: str) -> str:
        return validate_login_customer_id(v)


class KeywordHistoricalMetricsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    keywords: List[str]
    language: str
    geo_target_constants: List[str]

    @field_validator("customer_id", mode="before")
    @classmethod
    def format_customer_id_field(cls, v: str) -> str:
        return format_customer_id(v)


class KeywordIdeasRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    keywords: List[str]
    language: str
    geo_target_constants: List[str]
    page_url: Optional[str] = None

    @field_validator("customer_id", mode="before")
    @classmethod
    def format_customer_id_field(cls, v: str) -> str:
        return format_customer_id(v)


def create_google_ads_client(sa_config: ServiceAccountConfig) -> GoogleAdsClient:
    """创建 Google Ads 客户端（服务账号认证）"""
    # 避免在生产日志中泄露敏感信息（developer_token / service account email / private key）
    logger.info(f"Google Ads client init (login_customer_id={sa_config.login_customer_id})")

    service_account_info = {
        "type": "service_account",
        "client_email": sa_config.email,
        "private_key": sa_config.private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(service_account_info, f)
        json_key_file_path = f.name

    client = GoogleAdsClient.load_from_dict(
        {
            "developer_token": sa_config.developer_token,
            "use_proto_plus": True,
            "login_customer_id": sa_config.login_customer_id,
            "json_key_file_path": json_key_file_path,
        },
    )

    try:
        os.unlink(json_key_file_path)
    except Exception as e:
        logger.warning(f"清理临时文件失败: {e}")

    return client


# 🔧 修复(2025-12-27): 国家代码到 Geo Target Constant ID 的映射
# 参考: https://developers.google.com/google-ads/api/reference/data/geotargets
GEO_TARGET_MAP = {
    # 北美
    'US': 2840,   # United States
    'CA': 2124,   # Canada
    'MX': 2484,   # Mexico

    # 欧洲
    'GB': 2826,   # United Kingdom
    'UK': 2826,   # United Kingdom (alias)
    'DE': 2276,   # Germany
    'FR': 2250,   # France
    'IT': 2380,   # Italy
    'ES': 2724,   # Spain
    'PT': 2620,   # Portugal
    'NL': 2528,   # Netherlands
    'BE': 2056,   # Belgium
    'AT': 2040,   # Austria
    'CH': 2756,   # Switzerland
    'SE': 2752,   # Sweden
    'NO': 2578,   # Norway
    'DK': 2208,   # Denmark
    'FI': 2246,   # Finland
    'PL': 2616,   # Poland
    'CZ': 2203,   # Czech Republic
    'HU': 2348,   # Hungary
    'GR': 2300,   # Greece
    'IE': 2372,   # Ireland
    'RO': 2642,   # Romania
    'BG': 2100,   # Bulgaria
    'HR': 2191,   # Croatia
    'RS': 2688,   # Serbia
    'SI': 2705,   # Slovenia
    'SK': 2703,   # Slovakia
    'UA': 2804,   # Ukraine
    'EE': 2233,   # Estonia
    'LV': 2428,   # Latvia
    'LT': 2440,   # Lithuania
    'RU': 2643,   # Russia

    # 亚洲
    'CN': 2156,   # China
    'JP': 2392,   # Japan
    'KR': 2410,   # South Korea
    'IN': 2356,   # India
    'ID': 2360,   # Indonesia
    'TH': 2764,   # Thailand
    'VN': 2704,   # Vietnam
    'PH': 2608,   # Philippines
    'MY': 2458,   # Malaysia
    'SG': 2702,   # Singapore
    'HK': 2344,   # Hong Kong
    'TW': 2158,   # Taiwan
    'BD': 2050,   # Bangladesh
    'PK': 2586,   # Pakistan

    # 中东
    'TR': 2792,   # Turkey
    'SA': 2682,   # Saudi Arabia
    'AE': 2784,   # United Arab Emirates
    'IL': 2376,   # Israel
    'EG': 2818,   # Egypt
    'IR': 2364,   # Iran
    'IQ': 2368,   # Iraq
    'QA': 2634,   # Qatar
    'KW': 2414,   # Kuwait

    # 大洋洲
    'AU': 2036,   # Australia
    'NZ': 2554,   # New Zealand

    # 南美
    'BR': 2076,   # Brazil
    'AR': 2032,   # Argentina
    'CO': 2170,   # Colombia
    'CL': 2152,   # Chile
    'PE': 2604,   # Peru
    'VE': 2862,   # Venezuela

    # 非洲
    'ZA': 2710,   # South Africa
    'NG': 2566,   # Nigeria
    'KE': 2404,   # Kenya
    'MA': 2504,   # Morocco
}

# 语言代码到 Constant ID 的映射
LANGUAGE_CODE_MAP = {
    'en': 1000,      # English
    'zh': 1017,      # Chinese (Simplified)
    'zh-cn': 1017,   # Chinese (Simplified)
    'zh-tw': 1018,   # Chinese (Traditional)
    'ja': 1005,      # Japanese
    'de': 1001,      # German
    'fr': 1002,      # French
    'es': 1003,      # Spanish
    'it': 1004,      # Italian
    'ko': 1012,      # Korean
    'ru': 1031,      # Russian
    'pt': 1014,      # Portuguese
    'ar': 1019,      # Arabic
    'hi': 1023,      # Hindi
    'nl': 1020,      # Dutch
    'th': 1033,      # Thai
    'vi': 1044,      # Vietnamese
    'tr': 1037,      # Turkish
    'sv': 1032,      # Swedish
    'da': 1009,      # Danish
    'fi': 1011,      # Finnish
    'no': 1013,      # Norwegian
    'pl': 1021,      # Polish
    'cs': 1008,      # Czech
    'hu': 1024,      # Hungarian
    'el': 1022,      # Greek
    'he': 1025,      # Hebrew
    'id': 1027,      # Indonesian
    'ms': 1019,      # Malay
    'tl': 1034,      # Tagalog
}

# 语言名称到语言代码的映射
LANGUAGE_NAME_MAP = {
    'english': 'en',
    'chinese (simplified)': 'zh-cn',
    'chinese (traditional)': 'zh-tw',
    'chinese': 'zh',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'japanese': 'ja',
    'korean': 'ko',
    'portuguese': 'pt',
    'italian': 'it',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
    'dutch': 'nl',
    'thai': 'th',
    'vietnamese': 'vi',
    'turkish': 'tr',
    'swedish': 'sv',
    'danish': 'da',
    'finnish': 'fi',
    'norwegian': 'no',
    'polish': 'pl',
    'czech': 'cs',
    'hungarian': 'hu',
    'greek': 'el',
    'hebrew': 'he',
    'indonesian': 'id',
    'malay': 'ms',
}


def get_geo_target_constant_id(country_code: str) -> Optional[int]:
    """根据国家代码获取 Geo Target Constant ID"""
    return GEO_TARGET_MAP.get(country_code.upper())


def get_language_constant_id(language_input: str) -> Optional[int]:
    """根据语言输入获取 Language Constant ID"""
    lang = language_input.lower().strip()
    # 先尝试直接匹配代码
    if lang in LANGUAGE_CODE_MAP:
        return LANGUAGE_CODE_MAP[lang]
    # 再尝试匹配名称
    return LANGUAGE_CODE_MAP.get(LANGUAGE_NAME_MAP.get(lang, ''))


@app.post("/api/keyword-planner/historical-metrics")
async def get_keyword_historical_metrics(request: KeywordHistoricalMetricsRequest):
    """查询关键词历史数据"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordHistoricalMetricsRequest")
        request_obj.customer_id = request.customer_id
        request_obj.keywords.extend(request.keywords)
        request_obj.language = request.language
        request_obj.geo_target_constants.extend(request.geo_target_constants)
        request_obj.keyword_plan_network = (
            client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
        )

        response = keyword_plan_idea_service.generate_keyword_historical_metrics(
            request=request_obj
        )

        results = []
        for result in response.results:
            metrics = result.keyword_metrics
            results.append(
                {
                    "text": result.text,
                    "keyword_metrics": {
                        "avg_monthly_searches": metrics.avg_monthly_searches,
                        "competition": metrics.competition.name,
                        "competition_index": metrics.competition_index,
                        "low_top_of_page_bid_micros": metrics.low_top_of_page_bid_micros,
                        "high_top_of_page_bid_micros": metrics.high_top_of_page_bid_micros,
                    }
                    if metrics
                    else None,
                }
            )

        return {"results": results}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Keyword historical metrics error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/keyword-planner/ideas")
async def get_keyword_ideas(request: KeywordIdeasRequest):
    """生成关键词建议"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordIdeasRequest")
        request_obj.customer_id = request.customer_id
        request_obj.language = request.language
        request_obj.geo_target_constants.extend(request.geo_target_constants)
        request_obj.keyword_plan_network = (
            client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
        )

        # ✅ 正确实现 Keyword Planner 的 "keywords + site filter"
        # GenerateKeywordIdeasRequest 的 seed 是 oneof：
        # - keyword_seed
        # - url_seed
        # - keyword_and_url_seed
        has_keywords = bool(request.keywords)
        if request.page_url and has_keywords:
            request_obj.keyword_and_url_seed.url = request.page_url
            request_obj.keyword_and_url_seed.keywords.extend(request.keywords)
        elif request.page_url:
            request_obj.url_seed.url = request.page_url
        else:
            request_obj.keyword_seed.keywords.extend(request.keywords)

        response = keyword_plan_idea_service.generate_keyword_ideas(request=request_obj)

        results = []
        for idea in response.results:
            metrics = idea.keyword_idea_metrics
            results.append(
                {
                    "text": idea.text,
                    "keyword_idea_metrics": {
                        "avg_monthly_searches": metrics.avg_monthly_searches,
                        "competition": metrics.competition.name,
                        "competition_index": metrics.competition_index,
                        "low_top_of_page_bid_micros": metrics.low_top_of_page_bid_micros,
                        "high_top_of_page_bid_micros": metrics.high_top_of_page_bid_micros,
                    }
                    if metrics
                    else None,
                }
            )

        return {"results": results}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Keyword ideas error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "ok"}


class ListAccessibleCustomersRequest(BaseModel):
    service_account: ServiceAccountConfig


@app.post("/api/google-ads/list-accessible-customers")
async def list_accessible_customers(request: ListAccessibleCustomersRequest):
    user_id = request.service_account.user_id
    """获取可访问的客户账户列表"""
    try:
        client = create_google_ads_client(request.service_account)
        customer_service = client.get_service("CustomerService")

        accessible_customers = customer_service.list_accessible_customers()
        resource_names = accessible_customers.resource_names

        return {"resource_names": list(resource_names)}

    except Exception as e:
        logger.error(f"[user_id={user_id}] List accessible customers error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GAQLQueryRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    query: str


@app.post("/api/google-ads/query")
async def execute_gaql_query(request: GAQLQueryRequest):
    user_id = request.service_account.user_id
    """执行 GAQL 查询（用于 Performance Sync、Campaign 查询等）"""
    try:
        from google.protobuf.json_format import MessageToDict

        client = create_google_ads_client(request.service_account)
        ga_service = client.get_service("GoogleAdsService")

        # 🔧 修复(2025-12-26): 添加调试日志
        logger.info(f"[GAQL Query] login_customer_id={request.service_account.login_customer_id}, target_customer_id={request.customer_id}")

        response = ga_service.search(
            customer_id=request.customer_id, query=request.query
        )

        results = []
        for row in response:
            row_dict = MessageToDict(row._pb, preserving_proto_field_name=True)
            results.append(row_dict)

        return {"results": results}

    except Exception as e:
        error_str = str(e)

        # 🔧 修复(2025-12-30): DEVELOPER_TOKEN_NOT_APPROVED 是配置错误，必须明确告知用户
        # 不能静默处理为"预期错误"
        if "DEVELOPER_TOKEN_NOT_APPROVED" in error_str:
            logger.error(f"[user_id={user_id}] Developer Token 权限不足: {e}")
            raise HTTPException(
                status_code=403,
                detail="Developer Token 权限不足。测试权限的 Token 只能访问测试账号，无法访问真实账号。请升级到 Basic 或 Standard Access 权限。"
            )

        # 🔧 修复(2025-12-26): 对预期内的错误返回空结果，而非500错误
        # 这些错误表示账户状态异常，查询预算返回空结果是合理的
        expected_errors = [
            "CUSTOMER_NOT_ENABLED",
            "PERMISSION_DENIED",
            "The customer account can't be accessed because it is not yet enabled or has been deactivated",
            "caller does not have permission"
        ]
        if any(err in error_str for err in expected_errors):
            logger.warn(f"[user_id={user_id}] GAQL query expected error (returning empty): {e}")
            return {"results": []}
        logger.error(f"[user_id={user_id}] GAQL query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class IdentityVerificationRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str

    @field_validator("customer_id", mode="before")
    @classmethod
    def format_customer_id_field(cls, v: str) -> str:
        return format_customer_id(v)


@app.post("/api/google-ads/identity-verification")
async def get_identity_verification(request: IdentityVerificationRequest):
    user_id = request.service_account.user_id
    """获取广告主身份验证信息（IdentityVerificationService）"""
    try:
        from google.protobuf.json_format import MessageToDict

        client = create_google_ads_client(request.service_account)
        identity_service = client.get_service("IdentityVerificationService")

        response = identity_service.get_identity_verification(
            customer_id=request.customer_id
        )

        response_dict = MessageToDict(
            response._pb, preserving_proto_field_name=True
        )

        return response_dict

    except Exception as e:
        logger.error(f"[user_id={user_id}] Identity verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCampaignBudgetRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    name: str
    amount_micros: int
    delivery_method: str  # "STANDARD" or "ACCELERATED"


@app.post("/api/google-ads/campaign-budget/create")
async def create_campaign_budget(request: CreateCampaignBudgetRequest):
    """创建广告系列预算"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_budget_service = client.get_service("CampaignBudgetService")

        operation = client.get_type("CampaignBudgetOperation")
        budget = operation.create
        budget.name = request.name
        budget.amount_micros = request.amount_micros
        budget.delivery_method = client.enums.BudgetDeliveryMethodEnum[
            request.delivery_method
        ]
        budget.explicitly_shared = False

        response = campaign_budget_service.mutate_campaign_budgets(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Create campaign budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCampaignRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    name: str
    budget_resource_name: str
    status: str
    bidding_strategy_type: str
    cpc_bid_ceiling_micros: Optional[int] = None
    target_country: Optional[str] = None
    target_language: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    final_url_suffix: Optional[str] = None


@app.post("/api/google-ads/campaign/create")
async def create_campaign(request: CreateCampaignRequest):
    """创建搜索广告系列"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.create
        campaign.name = request.name
        campaign.status = client.enums.CampaignStatusEnum[request.status]
        campaign.advertising_channel_type = (
            client.enums.AdvertisingChannelTypeEnum.SEARCH
        )
        campaign.campaign_budget = request.budget_resource_name

        # Network settings
        campaign.network_settings.target_google_search = True
        campaign.network_settings.target_search_network = True
        campaign.network_settings.target_content_network = False
        campaign.network_settings.target_partner_search_network = False

        # Bidding strategy
        campaign.bidding_strategy_type = client.enums.BiddingStrategyTypeEnum[
            request.bidding_strategy_type
        ]
        if request.cpc_bid_ceiling_micros:
            campaign.target_spend.cpc_bid_ceiling_micros = (
                request.cpc_bid_ceiling_micros
            )

        # 🔧 修复(2025-12-30): 移除不兼容的字段
        # - final_url_expansion_opt_out: 仅支持Performance Max和AI Max Search，普通Search Campaign不支持
        # - goal_config_settings: Campaign对象中不存在此字段，应使用ConversionGoalCampaignConfig资源
        # 转化目标将使用账号级别的默认配置

        # 🔧 修复(2025-12-27): 添加必填字段 contains_eu_political_advertising
        # 大多数Campaign不包含政治广告，设置为DOES_NOT_CONTAIN
        campaign.contains_eu_political_advertising = client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING

        # Geo target type
        campaign.geo_target_type_setting.positive_geo_target_type = (
            client.enums.PositiveGeoTargetTypeEnum.PRESENCE
        )

        # 🔧 修复(2026-02-24): 兼容 Google Ads API v23 日期字段变更
        # v23 将 Campaign.start_date/end_date 替换为 start_date_time/end_date_time
        def normalize_campaign_date(value: str) -> str:
            raw = value.strip().replace('/', '-')
            m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', raw)
            if m:
                return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            m = re.match(r'^(\d{4})(\d{2})(\d{2})$', raw)
            if m:
                return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            return raw

        if request.start_date:
            normalized_start_date = normalize_campaign_date(request.start_date)
            if hasattr(campaign, "start_date_time"):
                campaign.start_date_time = f"{normalized_start_date} 00:00:00"
            else:
                campaign.start_date = normalized_start_date.replace('-', '')
        if request.end_date:
            normalized_end_date = normalize_campaign_date(request.end_date)
            if hasattr(campaign, "end_date_time"):
                campaign.end_date_time = f"{normalized_end_date} 23:59:59"
            else:
                campaign.end_date = normalized_end_date.replace('-', '')

        # 🔧 修复(2026-02-12): 统一清理 Final URL Suffix，避免 SYMBOLS policy（如全角分号）
        campaign.final_url_suffix = sanitize_final_url_suffix(request.final_url_suffix)

        response = campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        # 🔧 修复(2025-12-27): 添加地理位置和语言定位（与OAuth模式一致）
        campaign_resource_name = response.results[0].resource_name
        logger.info(f"[user_id={user_id}] Campaign创建成功: {campaign_resource_name}")

        # 添加地理位置定位
        if request.target_country:
            geo_target_id = get_geo_target_constant_id(request.target_country)
            if geo_target_id:
                try:
                    campaign_criterion_service = client.get_service("CampaignCriterionService")
                    geo_operation = client.get_type("CampaignCriterionOperation")
                    geo_criterion = geo_operation.create
                    geo_criterion.campaign = campaign_resource_name
                    geo_criterion.location.geo_target_constant = f"geoTargetConstants/{geo_target_id}"
                    campaign_criterion_service.mutate_campaign_criteria(
                        customer_id=request.customer_id, operations=[geo_operation]
                    )
                    logger.info(f"[user_id={user_id}] 添加地理位置定位: {request.target_country} ({geo_target_id})")
                except Exception as e:
                    logger.warning(f"[user_id={user_id}] 添加地理位置定位失败: {e}")

        # 添加语言定位
        if request.target_language:
            language_id = get_language_constant_id(request.target_language)
            if language_id:
                try:
                    campaign_criterion_service = client.get_service("CampaignCriterionService")
                    lang_operation = client.get_type("CampaignCriterionOperation")
                    lang_criterion = lang_operation.create
                    lang_criterion.campaign = campaign_resource_name
                    lang_criterion.language.language_constant = f"languageConstants/{language_id}"
                    campaign_criterion_service.mutate_campaign_criteria(
                        customer_id=request.customer_id, operations=[lang_operation]
                    )
                    logger.info(f"[user_id={user_id}] 添加语言定位: {request.target_language} ({language_id})")
                except Exception as e:
                    logger.warning(f"[user_id={user_id}] 添加语言定位失败: {e}")

        return {"resource_name": campaign_resource_name}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Create campaign error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateAdGroupRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    name: str
    status: str
    cpc_bid_micros: Optional[int] = None


@app.post("/api/google-ads/ad-group/create")
async def create_ad_group(request: CreateAdGroupRequest):
    """创建广告组"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_service = client.get_service("AdGroupService")

        operation = client.get_type("AdGroupOperation")
        ad_group = operation.create
        ad_group.name = request.name
        ad_group.campaign = request.campaign_resource_name
        ad_group.status = client.enums.AdGroupStatusEnum[request.status]
        ad_group.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD

        if request.cpc_bid_micros:
            ad_group.cpc_bid_micros = request.cpc_bid_micros

        response = ad_group_service.mutate_ad_groups(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"Create ad group error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class KeywordData(BaseModel):
    text: str
    match_type: str
    status: str
    final_url: Optional[str] = None
    is_negative: bool = False
    negative_keyword_match_type: str = 'EXACT'


class CreateKeywordsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    keywords: List[KeywordData]


@app.post("/api/google-ads/keywords/create")
async def create_keywords(request: CreateKeywordsRequest):
    """批量创建关键词"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_criterion_service = client.get_service("AdGroupCriterionService")

        operations = []
        for kw in request.keywords:
            operation = client.get_type("AdGroupCriterionOperation")
            criterion = operation.create
            criterion.ad_group = request.ad_group_resource_name
            criterion.status = client.enums.AdGroupCriterionStatusEnum[kw.status]

            if kw.is_negative:
                criterion.negative = True
                # 负向词使用指定的匹配类型，默认 EXACT
                criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[
                    kw.negative_keyword_match_type or 'EXACT'
                ]
            else:
                criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[
                    kw.match_type
                ]

            # 清理关键词，移除Google Ads不支持的特殊字符
            sanitized_text = sanitize_keyword(kw.text)
            logger.info(f"Keyword sanitization: '{kw.text}' -> '{sanitized_text}'")
            criterion.keyword.text = sanitized_text

            if kw.final_url:
                criterion.final_urls.append(kw.final_url)

            operations.append(operation)

        response = ad_group_criterion_service.mutate_ad_group_criteria(
            customer_id=request.customer_id, operations=operations
        )

        return {
            "results": [
                {"resource_name": result.resource_name} for result in response.results
            ]
        }

    except Exception as e:
        logger.error(f"Create keywords error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateResponsiveSearchAdRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    headlines: List[str]
    descriptions: List[str]
    final_urls: List[str]
    final_url_suffix: Optional[str] = None
    path1: Optional[str] = None
    path2: Optional[str] = None


@app.post("/api/google-ads/responsive-search-ad/create")
async def create_responsive_search_ad(request: CreateResponsiveSearchAdRequest):
    """创建响应式搜索广告"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_ad_service = client.get_service("AdGroupAdService")

        operation = client.get_type("AdGroupAdOperation")
        ad_group_ad = operation.create
        ad_group_ad.ad_group = request.ad_group_resource_name
        ad_group_ad.status = client.enums.AdGroupAdStatusEnum.ENABLED

        # Responsive search ad
        rsa = ad_group_ad.ad.responsive_search_ad
        try:
            sanitized_headlines: List[str] = [
                sanitize_ad_text(headline, max_len=30) for headline in request.headlines
            ]
            sanitized_descriptions: List[str] = [
                sanitize_ad_text(description, max_len=90) for description in request.descriptions
            ]
        except ValueError as ve:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "AD_TEXT_VALIDATION_ERROR",
                    "message": str(ve),
                },
            )

        violations: List[Dict[str, Any]] = []
        for i, h in enumerate(sanitized_headlines):
            chars = find_prohibited_ad_text_chars(h)
            if chars:
                violations.append({"field": "headlines", "index": i, "chars": chars, "text": h})
        for i, d in enumerate(sanitized_descriptions):
            chars = find_prohibited_ad_text_chars(d)
            if chars:
                violations.append({"field": "descriptions", "index": i, "chars": chars, "text": d})

        if violations:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "AD_TEXT_POLICY_VIOLATION",
                    "reason": "PROHIBITED_SYMBOLS",
                    "violations": violations,
                },
            )

        for headline in sanitized_headlines:
            headline_asset = client.get_type("AdTextAsset")
            headline_asset.text = headline
            rsa.headlines.append(headline_asset)

        for description in sanitized_descriptions:
            desc_asset = client.get_type("AdTextAsset")
            desc_asset.text = description
            rsa.descriptions.append(desc_asset)

        ad_group_ad.ad.final_urls.extend(request.final_urls)

        # 🔧 修复(2025-12-27): 添加 Final URL Suffix
        if request.final_url_suffix:
            ad_group_ad.ad.final_url_suffix = sanitize_final_url_suffix(request.final_url_suffix)

        if request.path1:
            p1 = sanitize_rsa_path(request.path1, max_len=15)
            if p1:
                rsa.path1 = p1
        if request.path2:
            p2 = sanitize_rsa_path(request.path2, max_len=15)
            if p2:
                rsa.path2 = p2

        response = ad_group_ad_service.mutate_ad_group_ads(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e

        # 更友好的政策/参数错误映射，避免上游误判为 500
        try:
            from google.ads.googleads.errors import GoogleAdsException  # type: ignore
        except Exception:
            GoogleAdsException = None  # type: ignore

        if GoogleAdsException is not None and isinstance(e, GoogleAdsException):  # type: ignore
            policy_topics: List[Dict[str, Any]] = []
            for err in getattr(e, "failure", {}).errors if getattr(e, "failure", None) else []:
                details = getattr(err, "details", None)
                pfd = getattr(details, "policy_finding_details", None) if details else None
                if not pfd:
                    continue
                for entry in getattr(pfd, "policy_topic_entries", []):
                    policy_topics.append(
                        {
                            "topic": getattr(entry, "topic", None),
                            "type": str(getattr(entry, "type_", None)),
                            "evidences": [
                                list(getattr(ev, "text_list", None).texts)
                                for ev in getattr(entry, "evidences", [])
                                if getattr(ev, "text_list", None)
                            ],
                        }
                    )

            if policy_topics:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "GOOGLE_ADS_POLICY_FINDING",
                        "message": str(e),
                        "request_id": getattr(e, "request_id", None),
                        "policy_topics": policy_topics,
                    },
                )

        logger.error(f"Create responsive search ad error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignStatusRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    status: str


@app.post("/api/google-ads/campaign/update-status")
async def update_campaign_status(request: UpdateCampaignStatusRequest):
    """更新广告系列状态"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name
        campaign.status = client.enums.CampaignStatusEnum[request.status]

        # 🔧 修复(2025-12-27): v22 直接设置 update_mask 路径列表
        operation.update_mask.paths.append("status")

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Update campaign status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RemoveCampaignRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str


@app.post("/api/google-ads/campaign/remove")
async def remove_campaign(request: RemoveCampaignRequest):
    """删除广告系列（使用 remove 操作，而不是把 status 更新为 REMOVED）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        operation.remove = request.campaign_resource_name

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Remove campaign error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    cpc_bid_micros: Optional[int] = None
    max_cpc_bid_micros: Optional[int] = None
    target_cpa_micros: Optional[int] = None
    status: Optional[str] = None


@app.post("/api/google-ads/campaign/update")
async def update_campaign(request: UpdateCampaignRequest):
    """更新广告系列（支持 CPC、CPA、状态更新）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name

        # CPC 出价更新
        if request.cpc_bid_micros:
            campaign.target_spend.cpc_bid_ceiling_micros = request.cpc_bid_micros
            operation.update_mask.paths.append("target_spend.cpc_bid_ceiling_micros")

        # Maximize Clicks 最大 CPC 限制更新（我们系统发布时使用 TARGET_SPEND）
        if request.max_cpc_bid_micros:
            campaign.target_spend.cpc_bid_ceiling_micros = request.max_cpc_bid_micros
            operation.update_mask.paths.append("target_spend.cpc_bid_ceiling_micros")

        # CPA 出价更新
        if request.target_cpa_micros:
            campaign.target_cpa.target_cpa_micros = request.target_cpa_micros
            operation.update_mask.paths.append("target_cpa.target_cpa_micros")

        # 状态更新
        if request.status:
            campaign.status = client.enums.CampaignStatusEnum[request.status]
            operation.update_mask.paths.append("status")

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update campaign error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateAdGroupRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    cpc_bid_micros: Optional[int] = None


@app.post("/api/google-ads/adgroup/update")
async def update_ad_group(request: UpdateAdGroupRequest):
    """更新广告组（支持 CPC 出价更新）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_service = client.get_service("AdGroupService")

        operation = client.get_type("AdGroupOperation")
        ad_group = operation.update
        ad_group.resource_name = request.ad_group_resource_name

        # CPC 出价更新
        if request.cpc_bid_micros:
            ad_group.cpc_bid_micros = request.cpc_bid_micros
            operation.update_mask.paths.append("cpc_bid_micros")

        ad_group_service.mutate_ad_groups(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update ad group error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignBudgetRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    budget_amount_micros: int
    budget_resource_name: Optional[str] = None


@app.post("/api/google-ads/campaign/update-budget")
async def update_campaign_budget(request: UpdateCampaignBudgetRequest):
    """更新广告系列预算"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_budget_service = client.get_service("CampaignBudgetService")

        budget_resource_name = request.budget_resource_name

        # 如果未提供budget_resource_name，则查询获取
        if not budget_resource_name:
            ga_service = client.get_service("GoogleAdsService")
            query = f"""
                SELECT campaign.campaign_budget
                FROM campaign
                WHERE campaign.resource_name = '{request.campaign_resource_name}'
            """
            response = ga_service.search(
                customer_id=request.customer_id, query=query
            )
            for row in response:
                budget_resource_name = row.campaign.campaign_budget
                break

            if not budget_resource_name:
                raise Exception("Budget not found")

        # Update budget
        operation = client.get_type("CampaignBudgetOperation")
        budget = operation.update
        budget.resource_name = budget_resource_name
        budget.amount_micros = request.budget_amount_micros

        # 🔧 修复(2025-12-27): v22 直接设置 update_mask 路径列表
        operation.update_mask.paths.append("amount_micros")

        campaign_budget_service.mutate_campaign_budgets(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update campaign budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignFinalUrlSuffixRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    final_url_suffix: str


@app.post("/api/google-ads/campaign/update-final-url-suffix")
async def update_campaign_final_url_suffix(request: UpdateCampaignFinalUrlSuffixRequest):
    """更新广告系列 Final URL Suffix（用于URL Swap换链接任务）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name
        campaign.final_url_suffix = sanitize_final_url_suffix(request.final_url_suffix)

        # 🔧 修复(2025-12-27): v22 直接设置 update_mask 路径列表
        operation.update_mask.paths.append("final_url_suffix")

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        logger.info(f"[user_id={user_id}] Successfully updated campaign final URL suffix: {request.campaign_resource_name}")
        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update campaign final URL suffix error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCalloutExtensionsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    callout_texts: List[Any]  # 🔧 修复: 接受字符串或对象


@app.post("/api/google-ads/callout-extensions/create")
async def create_callout_extensions(request: CreateCalloutExtensionsRequest):
    """创建附加宣传信息"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)

        # 🔧 修复(2025-12-27): 兼容字符串数组和对象数组格式
        valid_callout_texts = []
        for item in request.callout_texts:
            if isinstance(item, str):
                raw_text = item.strip()
            elif isinstance(item, dict) and 'text' in item:
                raw_text = str(item['text']).strip()
            else:
                continue
            text = sanitize_ad_extension_text(raw_text, max_len=25)
            if text:
                valid_callout_texts.append(text)

        if not valid_callout_texts:
            raise HTTPException(status_code=400, detail="没有有效的Callout文本，无法创建Callout扩展")

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for text in valid_callout_texts:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            # Google Ads限制：最多25个字符（清理在入参阶段已完成）
            asset.callout_asset.callout_text = text
            asset_operations.append(operation)

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id, operations=asset_operations
        )

        # Link assets to campaign
        campaign_asset_service = client.get_service("CampaignAssetService")
        campaign_asset_operations = []
        for result in asset_response.results:
            operation = client.get_type("CampaignAssetOperation")
            campaign_asset = operation.create
            campaign_asset.campaign = request.campaign_resource_name
            campaign_asset.asset = result.resource_name
            campaign_asset.field_type = client.enums.AssetFieldTypeEnum.CALLOUT
            campaign_asset_operations.append(operation)

        campaign_asset_service.mutate_campaign_assets(
            customer_id=request.customer_id,
            operations=campaign_asset_operations,
        )

        # 🔧 修复(2025-12-27): 返回 asset_resource_names 供 Node.js 解析
        return {"success": True, "asset_resource_names": [r.resource_name for r in asset_response.results]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create callout extensions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SitelinkData(BaseModel):
    link_text: str
    final_url: str
    description1: Optional[str] = None
    description2: Optional[str] = None


class CreateSitelinkExtensionsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    sitelinks: List[SitelinkData]


@app.post("/api/google-ads/sitelink-extensions/create")
async def create_sitelink_extensions(request: CreateSitelinkExtensionsRequest):
    """创建附加链接"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for sitelink in request.sitelinks:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            # Google Ads限制：link_text 最多25个字符（先做 policy 清理）
            sanitized_link_text = sanitize_ad_extension_text(sitelink.link_text or '', max_len=25)
            if not sanitized_link_text:
                continue
            asset.sitelink_asset.link_text = sanitized_link_text
            asset.final_urls.append(sitelink.final_url)
            # description1 和 description2 最多35个字符
            # 如果 description1 存在但 description2 不存在，用 description1 填充
            if sitelink.description1 and sitelink.description1.strip():
                desc1 = sanitize_ad_extension_text(sitelink.description1, max_len=35)
                desc2_source = sitelink.description2 if sitelink.description2 else sitelink.description1
                desc2 = sanitize_ad_extension_text(desc2_source, max_len=35)
                if desc1:
                    asset.sitelink_asset.description1 = desc1
                    asset.sitelink_asset.description2 = desc2 if desc2 else desc1
            asset_operations.append(operation)

        if not asset_operations:
            raise HTTPException(status_code=400, detail="没有有效的Sitelink文本，无法创建Sitelink扩展")

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id, operations=asset_operations
        )

        # Link assets to campaign
        campaign_asset_service = client.get_service("CampaignAssetService")
        campaign_asset_operations = []
        for result in asset_response.results:
            operation = client.get_type("CampaignAssetOperation")
            campaign_asset = operation.create
            campaign_asset.campaign = request.campaign_resource_name
            campaign_asset.asset = result.resource_name
            campaign_asset.field_type = client.enums.AssetFieldTypeEnum.SITELINK
            campaign_asset_operations.append(operation)

        campaign_asset_service.mutate_campaign_assets(
            customer_id=request.customer_id,
            operations=campaign_asset_operations,
        )

        # 🔧 修复(2025-12-27): 返回 asset_resource_names 供 Node.js 解析
        return {"success": True, "asset_resource_names": [r.resource_name for r in asset_response.results]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[user_id={user_id}] Create sitelink extensions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class EnsureConversionGoalRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    conversion_action_name: str


@app.post("/api/google-ads/conversion-goal/ensure")
async def ensure_conversion_goal(request: EnsureConversionGoalRequest):
    """确保转化目标存在"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ga_service = client.get_service("GoogleAdsService")

        # Check if conversion action exists
        query = f"""
            SELECT conversion_action.id, conversion_action.name
            FROM conversion_action
            WHERE conversion_action.name = '{request.conversion_action_name}'
        """
        response = ga_service.search(
            customer_id=request.customer_id, query=query
        )

        for row in response:
            return {"resource_name": row.conversion_action.resource_name}

        # Create if not exists
        conversion_action_service = client.get_service("ConversionActionService")
        operation = client.get_type("ConversionActionOperation")
        conversion_action = operation.create
        conversion_action.name = request.conversion_action_name
        conversion_action.type_ = (
            client.enums.ConversionActionTypeEnum.WEBPAGE
        )
        conversion_action.category = (
            client.enums.ConversionActionCategoryEnum.DEFAULT
        )
        conversion_action.status = client.enums.ConversionActionStatusEnum.ENABLED
        conversion_action.value_settings.default_value = 1.0
        conversion_action.value_settings.always_use_default_value = True

        result = conversion_action_service.mutate_conversion_actions(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"resource_name": result.results[0].resource_name}

    except Exception as e:
        logger.error(f"Ensure conversion goal error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Conversion Goal Functions Removed ====================
#
# 🔧 移除说明 (2025-12-26):
# - UpdateCampaignConversionGoalRequest: 请求模型（已移除）
# - /api/google-ads/campaign-conversion-goal/update: 更新CampaignConversionGoal端点
#
# 原因: 对应的Node.js函数已移除，这些端点不再使用

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001, log_config=None, access_log=False)
