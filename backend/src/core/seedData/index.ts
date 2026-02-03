import { ensureBuiltInFlows } from './ensureBuiltInFlows';
import { ensureAdmins } from './ensureAdmins';

export const seedData = async () => {
  await ensureBuiltInFlows();
  await ensureAdmins();
};
