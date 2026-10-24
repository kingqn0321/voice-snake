const profileName = 'fast-v1';

function tuneModelConfig(source) {
  if (typeof source !== 'string' || !/^--frame-subsampling-factor=3\s*$/m.test(source)) {
    throw new Error('Expected a Chinese model with frame subsampling factor 3');
  }
  const lines = source.trimEnd().split(/\r?\n/).filter(line => !line.startsWith('--frames-per-chunk='));
  // Six input frames retain the model's subsampling ratio while reducing batching.
  lines.push('--frames-per-chunk=6');
  return lines.join('\n') + '\n';
}

module.exports = { profileName, tuneModelConfig };
