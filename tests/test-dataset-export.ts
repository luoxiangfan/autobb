/**
 * 测试Crawlee Dataset导出功能
 */

import {
  DatasetExporter,
  DatasetExportFormat,
  printDatasetSummary,
  exportDatasetToJSON,
} from '../src/lib/crawlee-dataset-exporter';

async function main() {
  console.log('🧪 测试Crawlee Dataset导出功能\n');

  try {
    // 1. 打印Dataset统计摘要
    console.log('1️⃣ 打印Dataset统计摘要:');
    await printDatasetSummary();

    // 2. 导出JSON（只导出成功数据）
    console.log('\n2️⃣ 导出成功数据为JSON:');
    const exporter = new DatasetExporter();
    const successData = await exporter.export({
      format: DatasetExportFormat.JSON,
      outputPath: './storage/dataset-success.json',
      clean: true,
      deduplicate: true,
      validate: true,
      filter: (item) => item.dataType !== 'error',
    });
    console.log(`✅ 成功数据已导出: ${successData}`);

    // 3. 导出CSV（所有数据）
    console.log('\n3️⃣ 导出所有数据为CSV:');
    const csvPath = await exporter.export({
      format: DatasetExportFormat.CSV,
      outputPath: './storage/dataset-all.csv',
      clean: true,
      deduplicate: true,
      validate: true,
    });
    console.log(`✅ CSV已导出: ${csvPath}`);

    // 4. 导出数据库格式（内存）
    console.log('\n4️⃣ 格式化为数据库格式:');
    const dbData = await exporter.export({
      format: DatasetExportFormat.DATABASE,
      clean: true,
      filter: (item) => item.dataType !== 'error',
    });
    console.log(`✅ 数据库格式记录数: ${(dbData as any[]).length}`);

    if ((dbData as any[]).length > 0) {
      console.log('\n📦 数据库格式示例（第1条）:');
      console.log(JSON.stringify((dbData as any[])[0], null, 2));
    }

    console.log('\n✅ 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

main();
