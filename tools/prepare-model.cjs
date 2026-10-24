const fs = require('node:fs/promises');
const path = require('node:path');
const { unzipSync } = require('fflate');
const tar = require('tar');
const { profileName, tuneModelConfig } = require('./voice-profile.cjs');

const name = 'vosk-model-small-cn-0.22';
const directory = path.resolve(__dirname, '../.models');
const original = path.join(directory, `${name}.tar.gz`);
const target = path.join(directory, `${name}-${profileName}.tar.gz`);

async function main() {
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.access(target);
    console.log(`Model ready: ${target}`);
    return;
  } catch {}
  const staging = await fs.mkdtemp(path.join(directory, 'prepare-'));
  try {
    const existing = await fs.access(original).then(() => true, () => false);
    if (existing) {
      console.log('Preparing low-latency profile from the existing Chinese model...');
      await tar.x({ file: original, cwd: staging, strict: true });
    } else {
      console.log(`Downloading ${name} from the Vosk publisher (about 42 MB)...`);
      const response = await fetch(`https://alphacephei.com/vosk/models/${name}.zip`,
        { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
      for (const [file, data] of Object.entries(entries)) {
        const destination = path.resolve(staging, file);
        if (!destination.startsWith(staging + path.sep)) throw new Error('Invalid archive path');
        if (file.endsWith('/')) await fs.mkdir(destination, { recursive: true });
        else {
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, data);
        }
      }
    }
    const configuration = path.join(staging, name, 'conf/model.conf');
    await fs.writeFile(configuration, tuneModelConfig(await fs.readFile(configuration, 'utf8')));
    await tar.c({ gzip: true, cwd: staging, file: target + '.partial' }, [name]);
    await fs.rename(target + '.partial', target);
  } finally {
    // mkdtemp creates this directory beneath the fixed project-local model root.
    if (path.dirname(staging) === directory && path.basename(staging).startsWith('prepare-')) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  console.log(`Model ready: ${target}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
