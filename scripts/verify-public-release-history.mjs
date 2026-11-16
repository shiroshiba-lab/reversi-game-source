import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  PREVIOUS_PRODUCT_VERSION,
  PREVIOUS_PUBLIC_COMMIT,
  PREVIOUS_PUBLIC_TAG_OBJECT,
  PUBLIC_ROOT_COMMIT,
  PRODUCT_VERSION,
} from './release-version.mjs';

const repositoryRoot = resolve(process.argv[2] ?? process.cwd());
const target = process.argv[3] ?? 'HEAD';

const capture = (args) => new Promise((resolveRun, reject) => {
  let stdout = '';
  let stderr = '';
  const child = spawn('git', args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => code === 0
    ? resolveRun(stdout.trim())
    : reject(new Error(`git ${args.join(' ')} exited with ${code}: ${stderr.trim()}`)));
});

const targetCommit = await capture(['rev-parse', `${target}^{commit}`]);
const commitCount = Number(await capture(['rev-list', '--count', targetCommit]));
const rootCommits = (await capture(['rev-list', '--max-parents=0', targetCommit])).split('\n').filter(Boolean);
const parentLine = await capture(['rev-list', '--parents', '--max-count=1', targetCommit]);
const parents = parentLine.split(' ').slice(1);
const previousTagType = await capture(['cat-file', '-t', `refs/tags/${PREVIOUS_PRODUCT_VERSION}`]);
const previousTagObject = await capture(['rev-parse', `refs/tags/${PREVIOUS_PRODUCT_VERSION}`]);
const previousTagCommit = await capture(['rev-parse', `refs/tags/${PREVIOUS_PRODUCT_VERSION}^{}`]);
const previousCommitCount = Number(await capture(['rev-list', '--count', PREVIOUS_PUBLIC_COMMIT]));

if (previousTagType !== 'tag') throw new Error(`${PREVIOUS_PRODUCT_VERSION} must remain an annotated tag`);
if (previousTagObject !== PREVIOUS_PUBLIC_TAG_OBJECT) throw new Error(`${PREVIOUS_PRODUCT_VERSION} tag object changed`);
if (previousTagCommit !== PREVIOUS_PUBLIC_COMMIT) throw new Error(`${PREVIOUS_PRODUCT_VERSION} tag target changed`);
if (rootCommits.length !== 1 || rootCommits[0] !== PUBLIC_ROOT_COMMIT) {
  throw new Error('public history must retain the single approved v2.0.0 root commit');
}
if (commitCount !== previousCommitCount + 1 || parents.length !== 1 || parents[0] !== PREVIOUS_PUBLIC_COMMIT) {
  throw new Error(`${PRODUCT_VERSION} must be exactly one normal commit after ${PREVIOUS_PRODUCT_VERSION}`);
}

let currentTagPresent = true;
try {
  const currentTagType = await capture(['cat-file', '-t', `refs/tags/${PRODUCT_VERSION}`]);
  const currentTagCommit = await capture(['rev-parse', `refs/tags/${PRODUCT_VERSION}^{}`]);
  if (currentTagType !== 'tag') throw new Error(`${PRODUCT_VERSION} must be an annotated tag`);
  if (currentTagCommit !== targetCommit) throw new Error(`${PRODUCT_VERSION} tag does not point to the release commit`);
} catch (error) {
  if (/Not a valid object name|unknown revision|ambiguous argument/.test(String(error))) currentTagPresent = false;
  else throw error;
}

console.log(JSON.stringify({
  targetCommit,
  commitCount,
  rootCommit: rootCommits[0],
  parentCommit: parents[0],
  previousAnnotatedTagObject: previousTagObject,
  previousTagCommit,
  currentTag: PRODUCT_VERSION,
  currentTagPresent,
  privateHistoryIncluded: false,
}, null, 2));
