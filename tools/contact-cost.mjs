import { ContactShell } from '../lib/softbody/contact-shell.ts';
import { ContactSkin } from '../lib/softbody/contact-skin.ts';
import { auditContact } from './contact-shape-audit.mjs';
const costs = {};
for (const [type, names] of [
  [
    ContactShell,
    [
      'beginStep',
      'project',
      'projectFaces',
      'measureWetting',
      'regularize',
      'stats',
    ],
  ],
  [ContactSkin, ['prepare', 'solve']],
])
  for (const name of names) {
    const fn = type.prototype[name],
      key = type.name + '.' + name;
    costs[key] = { ms: 0, count: 0 };
    type.prototype[name] = function (...args) {
      const start = performance.now();
      const r = fn.apply(this, args);
      costs[key].ms += performance.now() - start;
      costs[key].count++;
      return r;
    };
  }
await auditContact('crown', 35);
console.log(JSON.stringify(costs, null, 2));
