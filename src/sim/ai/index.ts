import { registerCommander } from './commander';
import { StrategicAI } from './strategic';

registerCommander('strategic', (w, team, level) => new StrategicAI(w, team, level));

export * from './commander';
export { StrategicAI };
