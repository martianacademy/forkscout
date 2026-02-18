import fs from 'fs';
import path from 'path';

interface Task {
  id: string;
  archetype_id: string;
  prompt: string;
  params: Record<string, any>;
  timestamp: string;
}

const archetypesPath = path.join(__dirname, 'archetypes.json');
const archetypesData: {archetypes: Archetype[]} = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
const archetypes = archetypesData.archetypes.find(a => a.id === task.archetype_id);

const tasksDir = __dirname;
const solveFiles = fs.readdirSync(tasksDir).filter(f => f.startsWith('solve_') && f.endsWith('.json')).sort().slice(-1);

if (solveFiles.length === 0) {
  console.log(JSON.stringify({error: 'No solve file found'}));
  process.exit(1);
}

const solveFile = path.join(tasksDir, solveFiles[0]);
const solveData = JSON.parse(fs.readFileSync(solveFile, 'utf8'));
const taskFile = path.join(tasksDir, `task_${solveData.task_id}.json`);
const task: Task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

const archetype = archetypesData.archetypes.find(a => a.id === task.archetype_id);
if (!archetype) {
  console.log(JSON.stringify({error: 'Archetype not found'}));
  process.exit(1);
}

// Eval verify expression (secure context)
const verifyFn = new Function('agent_answer', 'params', `return ${archetype.verify};`);
const passed = verifyFn(solveData.agent_answer, task.params);

const reportFile = path.join(tasksDir, `report_${solveData.task_id}.json`);
fs.writeFileSync(reportFile, JSON.stringify({
  task_id: solveData.task_id,
  passed,
  agent_answer: solveData.agent_answer,
  params: task.params
}, null, 2));

console.log(JSON.stringify({
  success: true,
  task_id: solveData.task_id,
  passed,
  score: passed ? 1 : 0
}, null, 2));