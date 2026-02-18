import fs from 'fs';
import path from 'path';

interface Task {
  id: string;
  archetype_id: string;
  prompt: string;
  params: Record<string, any>;
  timestamp: string;
}

const tasksDir = __dirname;
const taskFiles = fs.readdirSync(tasksDir).filter(f => f.startsWith('task_') && f.endsWith('.json')).sort().slice(-1); // latest

if (taskFiles.length === 0) {
  console.log(JSON.stringify({error: 'No task found'}));
  process.exit(1);
}

const taskFile = path.join(tasksDir, taskFiles[0]);
const task: Task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

// Mock solve - for real agent, this would be LLM response
let agentAnswer = '';
if (task.archetype_id === 'simple_math') {
  agentAnswer = (task.params.a + task.params.b).toString();
} else if (task.archetype_id === 'logic_puzzle') {
  agentAnswer = (task.params.num1 + task.params.num2).toString();
} else if (task.archetype_id === 'string_manip') {
  agentAnswer = task.params.word.split('').reverse().join('');
}

const solveFile = path.join(tasksDir, `solve_${task.id}.json`);
fs.writeFileSync(solveFile, JSON.stringify({task_id: task.id, prompt: task.prompt, agent_answer: agentAnswer}, null, 2));

console.log(JSON.stringify({
  success: true,
  task_id: task.id,
  prompt: task.prompt,
  agent_answer: agentAnswer,
  solve_file: solveFile
}, null, 2));