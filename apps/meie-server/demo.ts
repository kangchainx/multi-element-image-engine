import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

// Configuration
const COMFYUI_API_BASE = 'http://127.0.0.1:8000';
const WORKFLOW_FILE_PATH = './Unsaved Workflow.json';
const CLIENT_ID = randomUUID();
const POLL_INTERVAL_MS = 1000; // Poll every second
const MAX_POLL_ATTEMPTS = 300; // 5 minute timeout (SDXL需要更长时间)

// Types
interface WorkflowNode {
  inputs: Record<string, any>;
  class_type: string;
  _meta?: {
    title: string;
  };
}

interface Workflow {
  [nodeId: string]: WorkflowNode;
}

interface SubmitResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
}

interface ImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

interface NodeOutput {
  images?: ImageOutput[];
}

interface HistoryData {
  prompt: any;
  outputs: Record<string, NodeOutput>;
  status?: {
    completed?: boolean;
    messages?: any[];
  };
}

/**
 * Loads and parses the workflow JSON file
 * @returns {Promise<Workflow>} Parsed workflow data
 */
async function loadWorkflow(): Promise<Workflow> {
  try {
    const fileContent = await readFile(WORKFLOW_FILE_PATH, 'utf-8');
    const workflow = JSON.parse(fileContent) as Workflow;
    return workflow;
  } catch (error) {
    if (error instanceof Error) {
      if ('code' in error && error.code === 'ENOENT') {
        throw new Error(`Workflow file not found: ${WORKFLOW_FILE_PATH}`);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in workflow file: ${error.message}`);
      }
    }
    throw error;
  }
}

/**
 * Submits a workflow to the ComfyUI API
 * @param {Workflow} workflowData - The workflow configuration
 * @returns {Promise<SubmitResponse>} API response with prompt_id
 */
async function submitWorkflow(workflowData: Workflow): Promise<SubmitResponse> {
  const url = `${COMFYUI_API_BASE}/prompt`;
  const payload = {
    prompt: workflowData,
    client_id: CLIENT_ID
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed (${response.status}): ${errorText}`);
    }

    const result = await response.json() as SubmitResponse;

    // Check for node errors in the response
    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      throw new Error(`Workflow validation failed: ${JSON.stringify(result.node_errors)}`);
    }

    return result;
  } catch (error) {
    if (error instanceof Error && 'cause' in error) {
      const cause = error.cause as any;
      if (cause?.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to ComfyUI server at ${COMFYUI_API_BASE}. Is it running?`);
      }
    }
    throw error;
  }
}

/**
 * Polls the history endpoint until the prompt execution is complete
 * @param {string} promptId - The prompt ID to check
 * @returns {Promise<HistoryData>} History data with execution results
 */
async function pollHistory(promptId: string): Promise<HistoryData> {
  const url = `${COMFYUI_API_BASE}/history/${promptId}`;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`History request failed (${response.status})`);
      }

      const history = await response.json() as Record<string, HistoryData>;

      // Check if the prompt ID exists in history (execution complete)
      if (history[promptId]) {
        return history[promptId];
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    } catch (error) {
      if (error instanceof Error && 'cause' in error) {
        const cause = error.cause as any;
        if (cause?.code === 'ECONNREFUSED') {
          throw new Error(`Lost connection to ComfyUI server at ${COMFYUI_API_BASE}`);
        }
      }
      throw error;
    }
  }

  throw new Error(`Execution timeout: No results after ${MAX_POLL_ATTEMPTS} seconds`);
}

/**
 * Displays the execution results in a readable format
 * @param {HistoryData} historyData - The history data from ComfyUI
 */
function displayResults(historyData: HistoryData): void {
  console.log('\n=== Execution Results ===');

  // Display status
  const status = historyData.status;
  if (status?.completed) {
    console.log('✓ Status: Completed successfully');
  } else {
    console.log('✗ Status: Failed or incomplete');
    if (status?.messages) {
      console.log('Messages:', status.messages);
    }
  }

  // Display output images
  const outputs = historyData.outputs;
  if (outputs) {
    console.log('\n=== Generated Images ===');

    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
      if (nodeOutput.images) {
        nodeOutput.images.forEach((image, index) => {
          console.log(`Image ${index + 1}:`);
          console.log(`  Filename: ${image.filename}`);
          console.log(`  Subfolder: ${image.subfolder || 'output'}`);
          console.log(`  Type: ${image.type}`);
        });
      }
    }
  } else {
    console.log('\nNo output images found');
  }
}

/**
 * Displays workflow information before submission
 * @param {Workflow} workflow - The workflow data
 */
function displayWorkflowInfo(workflow: Workflow): void {
  console.log('\n=== Workflow Summary ===');

  // Extract key information from workflow nodes
  const checkpoint = workflow['4']?.inputs?.ckpt_name;
  const positivePrompt = workflow['6']?.inputs?.text;
  const negativePrompt = workflow['7']?.inputs?.text;
  const width = workflow['5']?.inputs?.width;
  const height = workflow['5']?.inputs?.height;
  const steps = workflow['3']?.inputs?.steps;
  const cfg = workflow['3']?.inputs?.cfg;
  const sampler = workflow['3']?.inputs?.sampler_name;

  if (checkpoint) console.log(`Model: ${checkpoint}`);
  if (positivePrompt) console.log(`Prompt: ${positivePrompt}`);
  if (negativePrompt) console.log(`Negative: ${negativePrompt}`);
  if (width && height) console.log(`Size: ${width}x${height}`);
  if (steps) console.log(`Steps: ${steps}`);
  if (cfg) console.log(`CFG: ${cfg}`);
  if (sampler) console.log(`Sampler: ${sampler}`);
}

/**
 * Main execution flow
 */
async function main(): Promise<void> {
  try {
    console.log('=== ComfyUI API Demo ===');
    console.log(`Client ID: ${CLIENT_ID}`);

    // Step 1: Load workflow
    console.log('\n[1/4] Loading workflow...');
    const workflow = await loadWorkflow();
    displayWorkflowInfo(workflow);

    // Step 2: Submit workflow
    console.log('\n[2/4] Submitting workflow to ComfyUI...');
    const submitResult = await submitWorkflow(workflow);
    console.log(`✓ Workflow submitted successfully`);
    console.log(`  Prompt ID: ${submitResult.prompt_id}`);
    console.log(`  Queue Number: ${submitResult.number}`);

    // Step 3: Poll for completion
    console.log('\n[3/4] Waiting for execution to complete...');
    const historyData = await pollHistory(submitResult.prompt_id);
    console.log('✓ Execution finished');

    // Step 4: Display results
    console.log('\n[4/4] Processing results...');
    displayResults(historyData);

    console.log('\n=== Demo Complete ===');
    console.log('Check your ComfyUI output directory for generated images.');

  } catch (error) {
    if (error instanceof Error) {
      console.error('\n❌ Error:', error.message);
    } else {
      console.error('\n❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

// Run the demo
main();
