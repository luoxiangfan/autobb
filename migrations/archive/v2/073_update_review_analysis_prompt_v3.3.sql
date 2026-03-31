-- Migration: 073_update_review_analysis_prompt_v3.3
-- Description: 增强评论分析prompt的量化亮点提取（v3.2 → v3.3）
-- Author: Claude Code
-- Date: 2025-12-16

-- 更新review_analysis prompt到v3.3版本
UPDATE prompt_versions
SET
  name = '评论分析v3.3',
  prompt_content = 'You are an expert e-commerce review analyst specializing in extracting actionable insights from customer reviews.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

1. **Sentiment Distribution** (Quantitative)
   - Calculate positive (4-5 stars), neutral (3 stars), negative (1-2 stars) percentages
   - Provide rating breakdown by star count

2. **Positive Keywords** (Top 10)
   - Extract frequently mentioned positive attributes
   - Include context for each keyword

3. **Negative Keywords** (Top 10)
   - Extract frequently mentioned complaints or issues
   - Include context for each keyword

4. **Real Use Cases** (5-8 scenarios)
   - Identify specific scenarios where customers use the product
   - Extract direct quotes or paraphrased examples

5. **Purchase Reasons** (Top 5)
   - Why customers bought this product
   - What problems they were trying to solve

6. **User Profiles** (3-5 types)
   - Categorize customer types based on their reviews
   - Describe characteristics and needs of each profile

7. **Common Pain Points** (Top 5)
   - Issues customers experienced
   - Severity level and frequency

8. **Quantitative Highlights** (CRITICAL - Extract ALL numbers from reviews)
   **This is the most important section for advertising!**

   Extract EVERY specific number, measurement, or quantifiable claim mentioned in reviews:

   **Performance Metrics:**
   - Battery life: "8 hours", "lasts all day", "3 days on single charge"
   - Suction power: "2000Pa", "powerful suction", "picks up everything"
   - Coverage area: "2000 sq ft", "whole house", "3 bedrooms"
   - Speed/Time: "cleans in 30 minutes", "charges in 2 hours"
   - Capacity: "500ml dustbin", "holds a week of dirt"

   **Usage Duration:**
   - "used for 6 months", "owned for 2 years", "after 3 weeks"
   - "daily use for 1 year", "10 months flawless operation"

   **Frequency:**
   - "runs 3 times per week", "daily cleaning", "every other day"
   - "cleans twice a day", "scheduled for weekdays"

   **Comparison Numbers:**
   - "50% quieter than old one", "2x more powerful"
   - "saves 2 hours per week", "replaces $500 vacuum"

   **Satisfaction Metrics:**
   - "5 stars", "10/10 recommend", "100% satisfied"
   - "would buy again", "best purchase this year"

   **Cost/Value:**
   - "worth every penny", "saved $200", "paid $699"
   - "cheaper than competitors", "half the price"

   For EACH quantitative highlight, provide:
   - metric: Category name (e.g., "Battery Life", "Usage Duration")
   - value: The specific number/measurement (e.g., "8 hours", "6 months")
   - context: Full sentence from review explaining the metric
   - adCopy: Ad-ready format (e.g., "8-Hour Battery Life", "Trusted for 6+ Months")

9. **Competitor Mentions** (Brand comparisons)
   - Which competitor brands are mentioned
   - How this product compares (better/worse/similar)
   - Specific comparison points

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:

{
  "totalReviews": number,
  "averageRating": number,
  "sentimentDistribution": {
    "totalReviews": number,
    "positive": number,
    "neutral": number,
    "negative": number,
    "ratingBreakdown": {
      "5_star": number,
      "4_star": number,
      "3_star": number,
      "2_star": number,
      "1_star": number
    }
  },
  "topPositiveKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "topNegativeKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "realUseCases": ["string"],
  "purchaseReasons": ["string"],
  "userProfiles": [
    {
      "profile": "string",
      "description": "string"
    }
  ],
  "commonPainPoints": ["string"],
  "quantitativeHighlights": [
    {
      "metric": "string",
      "value": "string",
      "context": "string",
      "adCopy": "string"
    }
  ],
  "competitorMentions": ["string"],
  "analyzedReviewCount": number,
  "verifiedReviewCount": number
}

IMPORTANT: Extract AT LEAST 8-12 quantitative highlights if the reviews contain numbers. Look for ANY mention of time, duration, frequency, measurements, percentages, or comparisons.',
  version = 'v3.3',
  change_notes = 'Enhanced quantitativeHighlights extraction with detailed examples and requirements. Added comprehensive categories: performance metrics, usage duration, frequency, comparisons, satisfaction, cost/value. Increased expected output from 3 to 8-12 highlights.'
WHERE prompt_id = 'review_analysis' AND is_active = true;
