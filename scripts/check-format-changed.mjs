import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

import * as prettier from 'prettier';

const supported = /\.(?:css|js|json|md|mjs|ts|tsx|yaml|yml)$/i;

function gitResult(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

function gitLines(...args) {
  const output = gitResult(...args);
  if (output === null) return null;
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function validRevision(revision) {
  if (!revision || /^0+$/u.test(revision)) return false;
  return gitResult('rev-parse', '--verify', `${revision}^{commit}`) !== null;
}

function changedFiles() {
  const base = process.env.FORMAT_BASE;
  if (validRevision(base)) {
    return gitLines('diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`) ?? [];
  }

  const tracked = gitLines('diff', '--name-only', '--diff-filter=ACMR', 'HEAD') ?? [];
  const untracked = gitLines('ls-files', '--others', '--exclude-standard') ?? [];
  return [...new Set([...tracked, ...untracked])];
}

const candidates = changedFiles().filter((file) => supported.test(file) && existsSync(file));
const invalid = [];
const legacySkipped = [];
const configuredBase = process.env.FORMAT_BASE;
const baseline = validRevision(configuredBase) ? configuredBase : 'HEAD';

for (const file of candidates) {
  const info = await prettier.getFileInfo(file);
  if (info.ignored || !info.inferredParser) continue;

  const source = readFileSync(file, 'utf8');
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: file });

  const previous = gitResult('show', `${baseline}:${file}`);
  if (previous !== null) {
    const formattedPrevious = await prettier.format(previous, { ...config, filepath: file });
    if (previous !== formattedPrevious) {
      legacySkipped.push(file);
      continue;
    }
  }

  if (source !== formatted) invalid.push(file);
}

if (invalid.length > 0) {
  console.error('Prettier found formatting issues in changed files:');
  for (const file of invalid) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  const checked = candidates.length - legacySkipped.length;
  console.log(`Prettier check passed for ${checked} changed file(s).`);
  if (legacySkipped.length > 0) {
    console.log(`Skipped ${legacySkipped.length} legacy file(s) outside the format baseline.`);
  }
}
