const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
const steps = [];
let directory;

async function run(args) {
  const step = { command: `npm ${args.join(' ')}`, startedAt: new Date().toISOString() };
  steps.push(step);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: directory, env: process.env, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => {
      step.exitCode = code;
      step.finishedAt = new Date().toISOString();
      if (code === 0) resolve();
      else reject(new Error(`${step.command} exited with ${code}`));
    });
  });
}

async function main() {
  if (!npmCli) throw new Error('Run with npm run verify:clean so npm_execpath is available.');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  directory = await fs.mkdtemp(path.join(output, 'clean-'));
  // Copy only Git-visible source files, never ignored models, dependencies or results.
  const files = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const manifest = [];
  for (const file of files) {
    const source = path.resolve(root, file);
    const destination = path.resolve(directory, file);
    if (!source.startsWith(root + path.sep) || !destination.startsWith(directory + path.sep)) {
      throw new Error(`Source path outside workspace: ${file}`);
    }
    if (!(await fs.lstat(source)).isFile()) throw new Error(`Not a regular source file: ${file}`);
    const content = await fs.readFile(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
    manifest.push({ file, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const report = {
    startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceState: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }),
    directory, manifest, steps, status: 'running',
  };
  try {
    await run(['ci', '--ignore-scripts']);
    await run(['test']);
    await run(['run', 'setup:voice']);
    const model = await fs.stat(path.join(directory, '.models/vosk-model-small-cn-0.22-fast-v1.tar.gz'));
    if (model.size === 0) throw new Error('Prepared model is empty');
    report.modelBytes = model.size;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    const result = path.join(directory, 'verification.json');
    await fs.writeFile(result, JSON.stringify(report, null, 2) + '\n');
    console.log(`Clean-install report: ${result}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
