const fs = require('node:fs');

const columns = ['sample_id', 'kind', 'utterance', 'expected_command', 'required_state',
  'actual_command', 'result', 'confirm_ms', 'turn_ms', 'evidence', 'notes'];
const directions = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);
const commands = new Set([...directions, 'PAUSE', 'RESUME', 'RESTART', 'END']);
const results = new Set(['PASS', 'WRONG', 'TIMEOUT', 'DUPLICATE', 'NOT_RUN']);

// Handle spreadsheet CSV exports, including BOM, CRLF and quoted multiline notes.
function parseCsv(source) {
  source = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', state = 'plain';
  const endField = () => { row.push(field); field = ''; state = 'plain'; };
  const endRow = () => {
    endField();
    if (row.some(value => value !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; }
        else state = 'closed';
      } else field += char;
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else if (char === '"' && state === 'plain' && field === '') state = 'quoted';
    else {
      if (state === 'closed' || char === '"') throw new Error('CSV 引号格式错误');
      field += char;
    }
  }
  if (state === 'quoted') throw new Error('CSV 引号未闭合');
  if (field !== '' || row.length || state === 'closed') endRow();
  const header = rows.shift();
  if (!header || header.length !== columns.length || new Set(header).size !== header.length ||
      columns.some(name => !header.includes(name))) throw new Error('CSV 列名必须与验收模板一致');
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`数据行 ${index + 1} 列数错误`);
    return Object.fromEntries(header.map((name, i) => [name, values[i].trim()]));
  });
}

function latency(value, id, name) {
  if (value === '') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`${id}: ${name} 必须为有限的十进制毫秒数或留空`);
  }
  return Number(value);
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length,
    median: sorted.length ? sorted[Math.ceil(.5 * sorted.length) - 1] : null,
    p95: sorted.length ? sorted[Math.ceil(.95 * sorted.length) - 1] : null };
}

function summarize(source) {
  const rows = parseCsv(source), seen = new Set(), warnings = [];
  const stats = () => ({ total: 0, passed: 0, failed: 0, notRun: 0 });
  const valid = stats(), negative = stats(), confirms = [], turns = [], failures = [];
  let successfulDirections = 0, missingEvidence = 0;
  for (const row of rows) {
    const id = row.sample_id;
    const error = message => { throw new Error(`${id || '空 ID'}: ${message}`); };
    if (!id || seen.has(id)) error('样本 ID 为空或重复');
    seen.add(id);
    if (!['valid', 'negative'].includes(row.kind)) error('kind 必须为 valid 或 negative');
    if (!row.utterance) error('口令不能为空');
    if (!['READY', 'RUNNING', 'PAUSED', 'GAME_OVER', 'ENDED'].includes(row.required_state)) error('前置状态无效');
    if (row.kind === 'valid' ? !commands.has(row.expected_command) : row.expected_command !== 'NONE') error('预期命令无效');
    const result = row.result || 'NOT_RUN';
    if (!results.has(result)) error('结果必须为 PASS、WRONG、TIMEOUT、DUPLICATE、NOT_RUN 或留空');
    const confirm = latency(row.confirm_ms, id, 'confirm_ms');
    const turn = latency(row.turn_ms, id, 'turn_ms');
    if (result === 'NOT_RUN') {
      if (row.actual_command || confirm !== null || turn !== null) error('未测样本不能填写实际动作或延迟');
    } else {
      if (!commands.has(row.actual_command) && row.actual_command !== 'NONE') error('实际命令无效；无动作请填 NONE');
      if (result === 'PASS' && row.actual_command !== row.expected_command) error('PASS 的实际命令必须等于预期命令');
      if (row.kind === 'negative' && result !== 'PASS' && row.actual_command === 'NONE') error('负样本失败须记录实际误触动作');
      if (!row.evidence) missingEvidence += 1;
      if (result !== 'PASS' && !row.notes) warnings.push(`${id}: 失败原因未填写`);
    }
    if (turn !== null && (row.kind !== 'valid' || !directions.has(row.expected_command))) error('仅有效方向样本可填写转向延迟');
    if (confirm !== null && row.kind !== 'valid') error('负样本不填写指令确认延迟');
    const group = row.kind === 'valid' ? valid : negative;
    group.total += 1;
    if (result === 'NOT_RUN') group.notRun += 1;
    else if (result === 'PASS') group.passed += 1;
    else {
      group.failed += 1;
      failures.push({ id, result, actual: row.actual_command, notes: row.notes });
    }
    if (row.kind === 'valid' && result === 'PASS') {
      if (directions.has(row.expected_command)) successfulDirections += 1;
      // Measurements without evidence are reported as missing, not verified latency.
      if (row.evidence && confirm !== null) confirms.push(confirm);
      if (row.evidence && turn !== null) turns.push(turn);
    }
  }
  if (valid.total !== 50 || negative.total !== 10) warnings.push('样本数量不符合每环境 50 条有效、10 条负样本的计划');
  if (missingEvidence) warnings.push(`${missingEvidence} 条已测样本缺少证据位置；其延迟不参与统计`);
  return { valid, negative, confirm: quantiles(confirms), turn: quantiles(turns),
    successfulDirections, missingEvidence, warnings, failures };
}

function cell(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[`*_\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

function markdown(report, { environment, revision, input }) {
  const { valid, negative, confirm, turn } = report;
  const rate = valid.total ? `${(valid.passed / valid.total * 100).toFixed(1)}%` : '—';
  const complete = valid.total === 50 && negative.total === 10 && !valid.notRun && !negative.notRun;
  const numericTarget = complete ? (valid.passed >= 48 && negative.failed === 0 ? '达到' : '未达到') : '样本不完整，暂不判定';
  const lines = ['# 语音验收样本汇总', '',
    `环境 / 识别模式：${cell(environment)}`, '', `被测版本（填写值）：${cell(revision)}`, '',
    `输入文件：${cell(input)}`, '',
    '| 样本类型 | 总数 | 通过 | 失败 / 误触 | 未测 |', '| --- | ---: | ---: | ---: | ---: |',
    `| 有效口令 | ${valid.total} | ${valid.passed} | ${valid.failed} | ${valid.notRun} |`,
    `| 负样本 | ${negative.total} | ${negative.passed} | ${negative.failed} | ${negative.notRun} |`, '',
    `有效口令正确执行率：${rate}（通过 / 文件中全部有效样本；未测保留在分母）。`, '',
    `正确率及误触数量目标：${numericTarget}。缺失样本、证据及连续游戏仍需人工复核。`, '',
    '| 延迟（ms） | 有证据的成功样本数 | 中位数 | P95 | 成功样本中缺测数 |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| 指令确认 | ${confirm.count} | ${confirm.median ?? '—'} | ${confirm.p95 ?? '—'} | ${valid.passed - confirm.count} |`,
    `| 实际转向 | ${turn.count} | ${turn.median ?? '—'} | ${turn.p95 ?? '—'} | ${report.successfulDirections - turn.count} |`, '',
    '分位数使用 nearest-rank；允许负延迟。仅统计 PASS 且填写证据位置的测量值，失败及未测不参与延迟统计。', '',
    '本工具不核验录屏内容、环境或版本真实性，不自动判定完整实机验收通过；不同环境和识别模式应分别输入。'];
  if (report.failures.length) {
    lines.push('', '## 失败样本', '', '| ID | 结果 | 实际动作 | 原因 |', '| --- | --- | --- | --- |');
    for (const failure of report.failures) lines.push(`| ${cell(failure.id)} | ${failure.result} | ${failure.actual} | ${cell(failure.notes || '未填写')} |`);
  }
  if (report.warnings.length) lines.push('', '## 待补充事项', '', ...report.warnings.map(warning => `- ${cell(warning)}`));
  return lines.join('\n') + '\n';
}

function main(args) {
  const usage = '用法：node tools/summarize-acceptance.cjs <记录.csv> --environment "E03 macOS Chrome 本地 fast-v1" --revision <被测提交及工作区状态>';
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const [input, ...rest] = args;
  const options = {};
  if (!input || input.startsWith('-') || rest.length !== 4) throw new Error(usage);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--environment', '--revision'].includes(key) || options[key] || !rest[i + 1]?.trim() || rest[i + 1].startsWith('--')) throw new Error(usage);
    options[key] = rest[i + 1];
  }
  process.stdout.write(markdown(summarize(fs.readFileSync(input, 'utf8')), {
    input, environment: options['--environment'], revision: options['--revision'],
  }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`验收汇总失败：${error.message}`); process.exitCode = 1; }
}
module.exports = { parseCsv, summarize, markdown };
