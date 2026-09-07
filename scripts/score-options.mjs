import fs from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('src/lib/scoring.ts', root), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {scoreCandidates} = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
export {scoreCandidates};
export const configs = JSON.parse(fs.readFileSync(new URL('config/screeners.json',root),'utf8'));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(fs.readFileSync(0,'utf8'));
  const config = configs.find(c=>c.id===input.configId);
  if (!config) throw new Error('Unknown config');
  const scenario=config.scenarios.find(s=>s.id===input.scenarioId)??config.scenarios[0];
  process.stdout.write(JSON.stringify(scoreCandidates(config,scenario.filters,input.candidates,false)));
}
