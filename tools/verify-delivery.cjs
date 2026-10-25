const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.env.npm_execpath) throw new Error('Run with npm run verify:delivery.');
  const report = JSON.parse(await fs.readFile(path.join(root, 'test-results/delivery-latest.json'), 'utf8'));
  const base = path.dirname(path.resolve(root, report.siteRelative));
  for (const artifact of report.artifacts) {
    const bytes = await fs.readFile(path.join(base, path.basename(artifact.file)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.file);
  }
  const offline = report.artifacts.find(item => path.basename(item.file) === 'voice-snake-offline.zip');
  const entries = unzipSync(new Uint8Array(await fs.readFile(path.join(base, path.basename(offline.file)))));
  const extracted = await fs.mkdtemp(path.join(root, 'test-results/unpacked-'));
  for (const [name, bytes] of Object.entries(entries)) {
    const target = path.resolve(extracted, name);
    if (!target.startsWith(extracted + path.sep)) throw new Error(`Unsafe ZIP path: ${name}`);
    if (name.endsWith('/')) await fs.mkdir(target, { recursive: true });
    else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); }
  }
  const metadata = JSON.parse(await fs.readFile(path.join(extracted, 'delivery.json'), 'utf8'));
  assert.equal(metadata.commit, report.commit);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, 'test'], {
      cwd: extracted, env: process.env, stdio: 'inherit',
    });
    child.once('error', reject); child.once('exit', resolve);
  });
  const result = { commit: report.commit, sourceState: report.sourceState,
    extractedRelative: path.relative(root, extracted), hashesVerified: true,
    testExitCode: code, networkInstall: false, modelBytes: (await fs.stat(path.join(extracted,
      '.models/vosk-model-small-cn-0.22-fast-v1.tar.gz'))).size };
  await fs.writeFile(path.join(base, 'artifact-verification.json'), JSON.stringify(result, null, 2));
  assert.equal(code, 0, 'Unpacked offline package tests');
  console.log('PASS both ZIP hashes and offline package extraction/tests without dependency installation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
