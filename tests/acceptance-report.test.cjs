const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { parseCsv, summarize, markdown } = require('../tools/summarize-acceptance.cjs');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'docs/acceptance-samples.csv'), 'utf8');
const fields = template.split('\n')[0].split(',');
const sample = (changes = {}) => ({ sample_id: 'V01', kind: 'valid', utterance: '上',
  expected_command: 'UP', required_state: 'RUNNING', actual_command: 'UP', result: 'PASS',
  confirm_ms: '20', turn_ms: '40', evidence: 'demo.mp4 00:01–00:02', notes: '', ...changes });
const negative = (changes = {}) => sample({ sample_id: 'N01', kind: 'negative',
  utterance: '不要向左', expected_command: 'NONE', actual_command: 'NONE',
  confirm_ms: '', turn_ms: '', ...changes });
const csv = rows => [fields.join(','), ...rows.map(row => fields.map(field =>
  `"${String(row[field] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
const render = report => markdown(report, { environment: 'E03 Mac Chrome 本地 fast-v1', revision: 'abc123 clean', input: 'samples.csv' });

test('untouched repository template is 60 untested samples, never a passed acceptance', () => {
  const report = summarize(template);
  assert.deepEqual(report.valid, { total: 50, passed: 0, failed: 0, notRun: 50 });
  assert.deepEqual(report.negative, { total: 10, passed: 0, failed: 0, notRun: 10 });
  assert.deepEqual(report.confirm, { count: 0, median: null, p95: null });
  assert.match(render(report), /样本不完整，暂不判定/);
  assert.match(render(report), /正确执行率：0\.0%/);
});

test('spreadsheet CSV supports BOM, CRLF, escaped quotes, commas and multiline notes', () => {
  const notes = '说了两次, 首次为"上"\n第二次才成功';
  const source = '\uFEFF' + csv([sample({ notes })]) + '\r\n\r\n';
  assert.equal(parseCsv(source)[0].notes, notes);
  const report = summarize(source);
  assert.equal(report.valid.passed, 1);
  assert.match(render(report), /样本不完整，暂不判定/);
});

test('mixed outcomes keep untested samples in the denominator and failures out of latency', () => {
  const report = summarize(csv([
    sample(),
    sample({ sample_id: 'V02', result: 'WRONG', actual_command: 'LEFT', confirm_ms: '9999', turn_ms: '9999', notes: '误转向' }),
    sample({ sample_id: 'V03', result: 'TIMEOUT', actual_command: 'NONE', confirm_ms: '', turn_ms: '', notes: '3 秒无动作' }),
    sample({ sample_id: 'V04', result: 'DUPLICATE', notes: '执行两次' }),
    sample({ sample_id: 'V05', result: '', actual_command: '', confirm_ms: '', turn_ms: '', evidence: '' }),
    negative(), negative({ sample_id: 'N02', result: 'WRONG', actual_command: 'LEFT', notes: '否定句误触' }),
  ]));
  assert.deepEqual(report.valid, { total: 5, passed: 1, failed: 3, notRun: 1 });
  assert.deepEqual(report.negative, { total: 2, passed: 1, failed: 1, notRun: 0 });
  assert.deepEqual(report.confirm, { count: 1, median: 20, p95: 20 });
  assert.equal(report.failures.length, 4);
  assert.match(render(report), /正确执行率：20\.0%/);
});

test('nearest-rank uses the lower middle for even counts and retains negative latency', () => {
  const rows = Array.from({ length: 20 }, (_, i) => sample({ sample_id: `V${i}`, confirm_ms: String(i - 10), turn_ms: String(i - 5) }));
  const report = summarize(csv(rows.reverse()));
  assert.deepEqual(report.confirm, { count: 20, median: -1, p95: 8 });
  assert.deepEqual(report.turn, { count: 20, median: 4, p95: 13 });
});

test('only evidenced successful measurements count; state commands have no turn denominator', () => {
  const report = summarize(csv([
    sample({ evidence: '' }),
    sample({ sample_id: 'V02', confirm_ms: '', turn_ms: '' }),
    sample({ sample_id: 'V03', expected_command: 'PAUSE', actual_command: 'PAUSE', turn_ms: '' }),
  ]));
  assert.equal(report.missingEvidence, 1);
  assert.equal(report.successfulDirections, 2);
  assert.equal(report.confirm.count, 1);
  assert.equal(report.turn.count, 0);
  assert.match(render(report), /缺少证据位置/);
  assert.match(render(report), /实际转向 \| 0 \| — \| — \| 2/);
});

test('full numeric target requires 48 of 50 successes and zero negative false triggers', () => {
  const rows = parseCsv(template).map(row => ({ ...row, result: 'PASS', actual_command: row.expected_command, evidence: 'recording 00:01' }));
  for (const row of rows.slice(0, 2)) Object.assign(row, { result: 'TIMEOUT', actual_command: 'NONE', notes: '超时' });
  assert.match(render(summarize(csv(rows))), /数量目标：达到/);
  rows[2].result = 'DUPLICATE';
  rows[2].notes = '重复';
  assert.match(render(summarize(csv(rows))), /数量目标：未达到/);
  rows[2].result = 'PASS';
  Object.assign(rows[50], { result: 'WRONG', actual_command: 'UP', notes: '误触' });
  assert.match(render(summarize(csv(rows))), /数量目标：未达到/);
});

test('duplicate IDs, invalid schema, malformed CSV and invalid values fail explicitly', () => {
  const cases = [
    [csv([sample(), sample()]), /ID.*重复/],
    [template.replace('sample_id', 'id'), /列名/],
    [template.replace('kind', 'sample_id'), /列名/],
    [template + '\nV99,valid', /列数/],
    [fields.join(',') + '\n"unfinished', /未闭合/],
    [fields.join(',') + '\n"id"x', /引号格式/],
    [csv([sample({ kind: 'other' })]), /kind/],
    [csv([sample({ result: 'FAIL' })]), /结果必须/],
    [csv([sample({ actual_command: 'LEFT' })]), /PASS/],
    [csv([sample({ result: 'NOT_RUN' })]), /未测样本/],
    [csv([sample({ required_state: 'OTHER' })]), /前置状态/],
    [csv([sample({ expected_command: 'NONE' })]), /预期命令/],
    [csv([sample({ actual_command: '' })]), /实际命令/],
    [csv([negative({ result: 'WRONG' })]), /实际误触/],
    [csv([negative({ turn_ms: '1' })]), /方向样本/],
    [csv([negative({ confirm_ms: '1' })]), /负样本/],
    ...['NaN', 'Infinity', '0x10', '12ms', '1e999', '--1'].map(value => [csv([sample({ confirm_ms: value })]), /毫秒数/]),
  ];
  for (const [source, expected] of cases) assert.throws(() => summarize(source), expected);
});

test('Markdown escapes user content and preserves table structure', () => {
  const report = summarize(csv([sample({ result: 'WRONG', actual_command: 'LEFT', notes: '<img>|[link](url)\n*wrong*' })]));
  const output = render(report);
  assert.ok(output.includes('&lt;img&gt;\\|\\[link\\](url) \\*wrong\\*'));
  assert.ok(!output.includes('<img>'));
});

test('CLI reports the template without modifying it, and rejects bad input without a partial report', () => {
  const tool = path.join(root, 'tools/summarize-acceptance.cjs');
  const args = [tool, path.join(root, 'docs/acceptance-samples.csv'), '--environment', 'E03 Mac Chrome local', '--revision', 'c2f4309 clean'];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /有效口令 \| 50 \| 0 \| 0 \| 50/);
  assert.match(run.stdout, /c2f4309 clean/);
  assert.equal(fs.readFileSync(args[1], 'utf8'), template);
  assert.equal(spawnSync(process.execPath, [tool, args[1]], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [tool, '--help'], { encoding: 'utf8' }).status, 0);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-snake-acceptance-'));
  try {
    const invalid = path.join(directory, 'invalid.csv');
    fs.writeFileSync(invalid, csv([sample({ confirm_ms: 'NaN' })]));
    const failure = spawnSync(process.execPath, [tool, invalid, ...args.slice(2)], { encoding: 'utf8' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /V01/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
