/**
 * Requirements 6-10 Real Environment Tests
 *
 * Tests:
 * 1. Proxy URL validation (Requirement 10)
 * 2. Proxy IP fetching (Requirement 10)
 * 3. Final URL resolution (Requirement 9)
 */

import axios from 'axios'

const BASE_URL = 'http://localhost:3002'
const PROXY_URL = process.env.PROXY_URL || ''

interface TestResult {
  test: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  message: string
  details?: any
}

const results: TestResult[] = []

async function testProxyValidation(): Promise<void> {
  console.log('\n=== Test 1: Proxy URL Validation ===')

  if (!PROXY_URL) {
    results.push({
      test: 'Proxy URL Validation',
      status: 'SKIP',
      message: 'PROXY_URL not configured in .env',
    })
    console.log('⚠️  SKIP: PROXY_URL not configured')
    return
  }

  try {
    // 测试代理URL验证
    const response = await axios.post(
      `${BASE_URL}/api/settings/proxy/validate`,
      {
        proxy_url: PROXY_URL,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': '1', // 模拟管理员用户
        },
      }
    )

    if (response.data.success) {
      results.push({
        test: 'Proxy URL Validation',
        status: 'PASS',
        message: 'Proxy URL validation successful',
        details: {
          country_code: response.data.data.country_code,
          country_name: response.data.data.country_name,
          test_ip: response.data.data.test_ip,
        },
      })
      console.log('✅ PASS: Proxy URL validation successful')
      console.log(`   Country: ${response.data.data.country_name} (${response.data.data.country_code})`)
      console.log(`   Test IP: ${response.data.data.test_ip}`)
    } else {
      results.push({
        test: 'Proxy URL Validation',
        status: 'FAIL',
        message: 'Proxy URL validation failed',
        details: response.data.errors,
      })
      console.log('❌ FAIL: Proxy URL validation failed')
      console.log(`   Errors: ${response.data.errors.join(', ')}`)
    }
  } catch (error: any) {
    results.push({
      test: 'Proxy URL Validation',
      status: 'FAIL',
      message: `Error: ${error.message}`,
      details: error.response?.data,
    })
    console.log(`❌ FAIL: ${error.message}`)
    if (error.response?.data?.errors) {
      console.log(`   Errors: ${error.response.data.errors.join(', ')}`)
    }
  }
}

async function testURLResolution(): Promise<void> {
  console.log('\n=== Test 2: Affiliate Link Resolution ===')

  const testLinks = [
    {
      name: 'Amazon Store (Reolink)',
      url: 'https://pboost.me/UKTs4I6',
      expectedBrand: 'Reolink',
      expectedDomain: 'amazon.com',
    },
    {
      name: 'ITEHIL独立站',
      url: 'https://pboost.me/xEAgQ8ec',
      expectedBrand: 'ITEHIL',
      expectedDomain: 'itehil.com',
    },
  ]

  for (const link of testLinks) {
    console.log(`\n--- Testing: ${link.name} ---`)

    try {
      // Note: We need to first create an offer to test this API
      // For now, we'll test the function directly
      console.log(`   Link: ${link.url}`)
      console.log('   ⚠️  Skipping API test (requires offer setup)')

      results.push({
        test: `URL Resolution: ${link.name}`,
        status: 'SKIP',
        message: 'Requires offer setup via UI',
        details: { url: link.url },
      })
    } catch (error: any) {
      results.push({
        test: `URL Resolution: ${link.name}`,
        status: 'FAIL',
        message: `Error: ${error.message}`,
        details: error.response?.data,
      })
      console.log(`   ❌ FAIL: ${error.message}`)
    }
  }
}

async function testDirectFunctionCalls(): Promise<void> {
  console.log('\n=== Test 3: Direct Function Calls ===')

  // Test URL Resolver directly
  console.log('\n--- Testing URL Resolver Function ---')

  try {
    const { resolveAffiliateLink } = await import('../src/lib/url-resolver')

    const testUrl = 'https://pboost.me/UKTs4I6'
    console.log(`   Resolving: ${testUrl}`)

    const result = await resolveAffiliateLink(testUrl, PROXY_URL || undefined)

    console.log(`   ✅ Resolved successfully:`)
    console.log(`      Redirect Count: ${result.redirectCount}`)
    console.log(`      Final URL: ${result.finalUrl}`)
    console.log(`      Final URL Suffix: ${result.finalUrlSuffix.substring(0, 100)}...`)

    results.push({
      test: 'URL Resolver Function',
      status: 'PASS',
      message: 'URL resolution successful',
      details: {
        redirectCount: result.redirectCount,
        finalUrlLength: result.finalUrl.length,
        suffixLength: result.finalUrlSuffix.length,
      },
    })
  } catch (error: any) {
    results.push({
      test: 'URL Resolver Function',
      status: 'FAIL',
      message: `Error: ${error.message}`,
    })
    console.log(`   ❌ FAIL: ${error.message}`)
  }

  // Test Proxy Validation Function
  console.log('\n--- Testing Proxy Validation Function ---')

  try {
    const { validateProxyUrl } = await import('../src/lib/proxy/validate-url')

    if (!PROXY_URL) {
      console.log('   ⚠️  SKIP: PROXY_URL not configured')
      results.push({
        test: 'Proxy Validation Function',
        status: 'SKIP',
        message: 'PROXY_URL not configured',
      })
    } else {
      const validation = validateProxyUrl(PROXY_URL)

      if (validation.isValid) {
        console.log(`   ✅ Validation PASS:`)
        console.log(`      Country Code: ${validation.countryCode}`)
        console.log(`      Errors: None`)

        results.push({
          test: 'Proxy Validation Function',
          status: 'PASS',
          message: 'Proxy URL format valid',
          details: { countryCode: validation.countryCode },
        })
      } else {
        console.log(`   ❌ Validation FAIL:`)
        console.log(`      Errors: ${validation.errors.join(', ')}`)

        results.push({
          test: 'Proxy Validation Function',
          status: 'FAIL',
          message: 'Proxy URL format invalid',
          details: { errors: validation.errors },
        })
      }
    }
  } catch (error: any) {
    results.push({
      test: 'Proxy Validation Function',
      status: 'FAIL',
      message: `Error: ${error.message}`,
    })
    console.log(`   ❌ FAIL: ${error.message}`)
  }

  // Test Proxy IP Fetching
  console.log('\n--- Testing Proxy IP Fetching ---')

  try {
    const { fetchProxyIp } = await import('../src/lib/proxy/fetch-proxy-ip')

    if (!PROXY_URL) {
      console.log('   ⚠️  SKIP: PROXY_URL not configured')
      results.push({
        test: 'Proxy IP Fetching',
        status: 'SKIP',
        message: 'PROXY_URL not configured',
      })
    } else {
      console.log(`   Fetching proxy IP from: ${PROXY_URL.substring(0, 50)}...`)

      const proxy = await fetchProxyIp(PROXY_URL)

      console.log(`   ✅ Proxy IP fetched successfully:`)
      console.log(`      Host: ${proxy.host}`)
      console.log(`      Port: ${proxy.port}`)
      console.log(`      Full Address: ${proxy.fullAddress}`)
      console.log(`      Username: ${proxy.username.substring(0, 20)}...`)

      results.push({
        test: 'Proxy IP Fetching',
        status: 'PASS',
        message: 'Proxy IP fetched successfully',
        details: {
          host: proxy.host,
          port: proxy.port,
          fullAddress: proxy.fullAddress,
        },
      })
    }
  } catch (error: any) {
    results.push({
      test: 'Proxy IP Fetching',
      status: 'FAIL',
      message: `Error: ${error.message}`,
    })
    console.log(`   ❌ FAIL: ${error.message}`)
  }
}

function printSummary(): void {
  console.log('\n\n' + '='.repeat(60))
  console.log('TEST SUMMARY')
  console.log('='.repeat(60))

  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length

  console.log(`\nTotal Tests: ${results.length}`)
  console.log(`✅ PASS: ${passed}`)
  console.log(`❌ FAIL: ${failed}`)
  console.log(`⚠️  SKIP: ${skipped}`)

  console.log('\n' + '-'.repeat(60))
  console.log('DETAILED RESULTS')
  console.log('-'.repeat(60))

  results.forEach((result, index) => {
    const icon =
      result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️'
    console.log(`\n${index + 1}. ${icon} ${result.test}`)
    console.log(`   Status: ${result.status}`)
    console.log(`   Message: ${result.message}`)
    if (result.details) {
      console.log(`   Details:`, JSON.stringify(result.details, null, 2))
    }
  })

  console.log('\n' + '='.repeat(60))
  console.log('TEST RUN COMPLETE')
  console.log('='.repeat(60))
}

async function runTests(): Promise<void> {
  console.log('🚀 Starting Requirements 6-10 Tests...')
  console.log(`Server URL: ${BASE_URL}`)
  console.log(`Proxy URL: ${PROXY_URL ? '✅ Configured' : '❌ Not configured'}`)

  await testProxyValidation()
  await testURLResolution()
  await testDirectFunctionCalls()

  printSummary()

  // Write results to file
  const fs = await import('fs/promises')
  await fs.writeFile(
    './test-results/requirements-6-10-test-results.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        baseUrl: BASE_URL,
        proxyConfigured: !!PROXY_URL,
        results,
      },
      null,
      2
    )
  )

  console.log('\n📄 Test results saved to: test-results/requirements-6-10-test-results.json')
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Test run failed:', error)
  process.exit(1)
})
