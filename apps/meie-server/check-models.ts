import { readFile, writeFile } from 'fs/promises';

const COMFYUI_API_BASE = 'http://127.0.0.1:8000';

/**
 * 获取ComfyUI中所有可用的checkpoint模型
 */
async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${COMFYUI_API_BASE}/object_info/CheckpointLoaderSimple`);
    const data = await response.json();

    const models = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    return models;
  } catch (error) {
    console.error('❌ 无法连接到ComfyUI服务器');
    throw error;
  }
}

/**
 * 更新workflow文件中的模型名称
 */
async function updateWorkflowModel(modelName: string): Promise<void> {
  const workflowPath = './Unsaved Workflow.json';

  try {
    const content = await readFile(workflowPath, 'utf-8');
    const workflow = JSON.parse(content);

    // 更新模型名称（node 4是CheckpointLoader）
    if (workflow['4'] && workflow['4'].inputs) {
      const oldModel = workflow['4'].inputs.ckpt_name;
      workflow['4'].inputs.ckpt_name = modelName;

      await writeFile(workflowPath, JSON.stringify(workflow, null, 2));
      console.log(`✓ Workflow已更新:`);
      console.log(`  旧模型: ${oldModel}`);
      console.log(`  新模型: ${modelName}`);
    }
  } catch (error) {
    console.error('❌ 更新workflow失败:', error);
    throw error;
  }
}

async function main() {
  console.log('=== ComfyUI 模型检查工具 ===\n');

  console.log('正在检查可用模型...');
  const models = await getAvailableModels();

  if (models.length === 0) {
    console.log('\n❌ 未找到任何模型！\n');
    console.log('你需要先安装模型。请按以下步骤操作：\n');
    console.log('1. 下载模型（推荐 Stable Diffusion v1.5）:');
    console.log('   https://huggingface.co/runwayml/stable-diffusion-v1-5\n');
    console.log('2. 将 .safetensors 文件放到这个目录:');
    console.log('   /Users/chris/Documents/ComfyUI/models/checkpoints/\n');
    console.log('3. 重启ComfyUI');
    console.log('4. 再次运行这个脚本\n');
    console.log('详细说明请查看: 模型安装指南.md');
    return;
  }

  console.log(`\n✓ 找到 ${models.length} 个可用模型:\n`);
  models.forEach((model, index) => {
    console.log(`  ${index + 1}. ${model}`);
  });

  console.log('\n是否要更新workflow使用第一个模型？');
  console.log(`将使用: ${models[0]}\n`);

  // 自动使用第一个模型
  await updateWorkflowModel(models[0]);

  console.log('\n✅ 完成！现在可以运行 npm start 测试了');
}

main().catch(error => {
  console.error('\n❌ 错误:', error.message);
  process.exit(1);
});
