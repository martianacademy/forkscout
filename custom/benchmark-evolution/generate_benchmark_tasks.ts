import fs from 'fs';
import path from 'path';

interface Archetype {
  id: string;
  prompt_template: string;
  param_gen: string;
  ground_truth: string;
  verify: string;
}

interface Task {
  id: string;
  archetype_id: string;
  prompt: string;
  params: Record<string, any>;
  timestamp: string;
}

const archetypesPath = path.join(__dirname, 'archetypes.json');
const archetypesData: {archetypes: Archetype[]} = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
const archetypes = archetypesData.archetypes;

const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];

// Generate params using new Function for safety
const paramFn = new Function('Math', archetype.param_gen);
const params = paramFn(Math);

// Fix: proper regex for {key} interpolation
const prompt = archetype.prompt_template.replace(/\{(\w+)\}/g, (_, key) => params[key]?.toString() || `{${key}}`);

const task: Task = {
  id: `${archetype.id}_${Date.now()}`,
  archetype_id: archetype.id,
  prompt,
  params,
  timestamp: new Date().toISOString()
};

const taskFile = path.join(__dirname, `task_${task.id}.json`);
fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));

console.log(JSON.stringify({
  success: true,
  task_id: task.id,
  prompt: task.prompt,
  params: task.params,
  file: taskFile
}, null, 2));