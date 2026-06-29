const axios = require('axios');
const columnMap = require('../../data/column-map.json');

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value ?? '').replace(/\r/g, '\n').trim();
}

function deriveFactoryFromSheet(title) {
  const t = cleanText(title);
  if (/苏州|SZ/i.test(t)) return '苏州';
  if (/铜陵|TL/i.test(t)) return '铜陵';
  if (/泰国|TH/i.test(t)) return '泰国';
  if (/CO[-_ ]?NPI/i.test(t)) return 'CO-NPI';
  if (/加急/.test(t)) return '加急';
  if (/库存/.test(t)) return '库存';
  return t || '未分类';
}

function findColumnIndex(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const c = normalizeHeader(candidate).toLowerCase();
    let idx = normalized.findIndex(h => h.toLowerCase() === c);
    if (idx >= 0) return idx;
    idx = normalized.findIndex(h => h.toLowerCase().includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

function excelSerialToDate(serial) {
  if (typeof serial !== 'number' || Number.isNaN(serial)) return null;
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return excelSerialToDate(value) || String(value);
  const text = String(value).trim();
  if (!text) return '';
  const serialMaybe = Number(text);
  if (/^\d{5}(\.\d+)?$/.test(text)) return excelSerialToDate(serialMaybe) || text;
  const m = text.match(/(20\d{2})[\-/\.年](\d{1,2})[\-/\.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const m2 = text.match(/(\d{1,2})[\-/\.月](\d{1,2})(?:日|号)?/);
  if (m2) {
    const year = new Date().getFullYear();
    return `${year}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  }
  return text;
}

function mapRowsToFixtures(values, sheetInfo = {}) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map(normalizeHeader);
  const indexes = {};
  for (const [key, candidates] of Object.entries(columnMap)) {
    indexes[key] = findColumnIndex(headers, candidates);
  }

  const sourceSheet = sheetInfo.title || sheetInfo.factory || '';
  const fallbackFactory = sheetInfo.factory || deriveFactoryFromSheet(sourceSheet);
  const sourceSheetId = sheetInfo.sheetId || '';

  return values.slice(1).map((row, i) => {
    const get = key => (indexes[key] >= 0 ? row[indexes[key]] : '');
    const factory = cleanText(get('factory')) || fallbackFactory;
    const fixtureCode = cleanText(get('fixtureCode'));
    const fixtureName = cleanText(get('fixtureName'));
    const supplier = cleanText(get('supplier'));
    const dueDate = parseDateValue(get('dueDate'));
    if (!supplier && !fixtureCode && !fixtureName && !dueDate) return null;

    return {
      sourceSheet,
      sourceSheetId,
      rowNumber: i + 2,
      factory,
      applicant: cleanText(get('applicant')),
      user: cleanText(get('user')),
      designer: cleanText(get('designer')),
      purchaseDate: parseDateValue(get('purchaseDate')),
      supplier,
      fixtureCode,
      fixtureName,
      quantity: cleanText(get('quantity')),
      outsourceStatus: cleanText(get('outsourceStatus')),
      dueDate,
      currentStatus: cleanText(get('currentStatus')),
      arrivalConfirm: cleanText(get('arrivalConfirm')),
      actualDeliveryDate: parseDateValue(get('actualDeliveryDate')),
      poDate: parseDateValue(get('poDate')),
      remark: cleanText(get('remark')),
      prNo: cleanText(get('prNo')),
      poNo: cleanText(get('poNo'))
    };
  }).filter(Boolean);
}

async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET');

  const resp = await axios.post(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret
  });
  if (resp.data.code !== 0) throw new Error(`获取 tenant_access_token 失败：${resp.data.msg}`);
  return resp.data.tenant_access_token;
}

async function resolveSpreadsheetToken(tenantToken) {
  if (process.env.FEISHU_SPREADSHEET_TOKEN) return process.env.FEISHU_SPREADSHEET_TOKEN;
  const wikiNodeToken = process.env.FEISHU_WIKI_NODE_TOKEN;
  if (!wikiNodeToken) throw new Error('缺少 FEISHU_SPREADSHEET_TOKEN 或 FEISHU_WIKI_NODE_TOKEN');

  const url = `${FEISHU_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiNodeToken)}`;
  const resp = await axios.get(url, { headers: { Authorization: `Bearer ${tenantToken}` } });
  if (resp.data.code !== 0) throw new Error(`解析 Wiki 节点失败：${resp.data.msg}`);
  const node = resp.data?.data?.node || resp.data?.data || {};
  const objToken = node.obj_token || node.objToken;
  if (!objToken) throw new Error('Wiki 节点没有返回 obj_token');
  return objToken;
}

async function getSheetsMeta(spreadsheetToken, tenantToken) {
  const headers = { Authorization: `Bearer ${tenantToken}` };
  try {
    const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`;
    const resp = await axios.get(url, { headers });
    if (resp.data.code === 0) {
      return (resp.data?.data?.sheets || []).map(s => ({
        sheetId: s.sheetId || s.sheet_id,
        title: s.title || s.name || s.sheetName || s.sheet_name || s.sheetId || s.sheet_id
      })).filter(s => s.sheetId);
    }
  } catch (e) {
    console.warn(`v2 metainfo 获取失败，尝试 v3：${e.message}`);
  }

  const url = `${FEISHU_BASE}/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`;
  const resp = await axios.get(url, { headers });
  if (resp.data.code !== 0) throw new Error(`获取工作表列表失败：${resp.data.msg}`);
  return (resp.data?.data?.sheets || []).map(s => ({
    sheetId: s.sheet_id || s.sheetId,
    title: s.title || s.name || s.sheet_id || s.sheetId
  })).filter(s => s.sheetId);
}

function parseRangesConfig(sheetsMeta = []) {
  const raw = String(process.env.FEISHU_SHEET_RANGES || 'ALL').trim();
  if (!raw || raw.toUpperCase() === 'ALL' || raw === '全部') {
    return sheetsMeta.map(s => ({
      factory: deriveFactoryFromSheet(s.title),
      title: s.title,
      sheetId: s.sheetId,
      range: `${s.sheetId}!A1:Z5000`
    }));
  }

  return raw.split(',').map(s => s.trim()).filter(Boolean).map(item => {
    const [label, rangePart] = item.includes('|') ? item.split('|') : ['', item];
    const range = rangePart.trim();
    const sheetId = range.split('!')[0];
    const meta = sheetsMeta.find(s => s.sheetId === sheetId) || {};
    return {
      factory: label.trim() || deriveFactoryFromSheet(meta.title || sheetId),
      title: meta.title || label.trim() || sheetId,
      sheetId,
      range
    };
  });
}

async function readFeishuRange(spreadsheetToken, tenantToken, range) {
  const url = `${FEISHU_BASE}/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`;
  const resp = await axios.get(url, { headers: { Authorization: `Bearer ${tenantToken}` } });
  if (resp.data.code !== 0) throw new Error(`读取飞书范围失败 ${range}：${resp.data.msg}`);
  return resp.data?.data?.valueRange?.values || [];
}

async function loadFixturesLive() {
  const tenantToken = await getTenantAccessToken();
  const spreadsheetToken = await resolveSpreadsheetToken(tenantToken);
  const sheetsMeta = await getSheetsMeta(spreadsheetToken, tenantToken);
  const configs = parseRangesConfig(sheetsMeta);
  const all = [];

  for (const cfg of configs) {
    const values = await readFeishuRange(spreadsheetToken, tenantToken, cfg.range);
    all.push(...mapRowsToFixtures(values, cfg));
  }
  return { tenantToken, data: all };
}

function parseMessageText(event) {
  const message = event?.message || {};
  let text = '';
  try {
    const content = JSON.parse(message.content || '{}');
    text = content.text || '';
  } catch {
    text = message.content || '';
  }

  for (const mention of message.mentions || []) {
    if (mention.name) text = text.replaceAll(`@${mention.name}`, '');
    if (mention.id?.open_id) text = text.replaceAll(`<at user_id="${mention.id.open_id}"></at>`, '');
  }

  return text
    .replace(/查询|查一下|帮我查|请问|治具|交期/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemSearchText(item) {
  return [
    item.fixtureCode,
    item.fixtureName,
    item.supplier,
    item.designer,
    item.factory,
    item.sourceSheet,
    item.currentStatus,
    item.remark,
    item.prNo
  ].filter(Boolean).join(' ').toLowerCase();
}

function scoreItem(item, query) {
  const q = query.toLowerCase();
  let score = 0;
  if (String(item.fixtureCode || '').toLowerCase().includes(q)) score += 100;
  if (String(item.supplier || '').toLowerCase().includes(q)) score += 60;
  if (String(item.fixtureName || '').toLowerCase().includes(q)) score += 50;
  if (String(item.designer || '').toLowerCase().includes(q)) score += 20;
  if (itemSearchText(item).includes(q)) score += 10;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (itemSearchText(item).includes(token)) score += 5;
  }
  return score;
}

function searchFixtures(data, query) {
  const q = query.trim();
  if (!q) return [];
  return data
    .map(item => ({ item, score: scoreItem(item, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.item);
}

function formatReply(items, query) {
  if (!query) {
    return [
      '请输入要查询的编码、厂商或治具名称。',
      '示例：',
      '@治具机器人 RD3SA0000009',
      '@治具机器人 万德锢',
      '@治具机器人 UV灯治具'
    ].join('\n');
  }

  if (!items.length) {
    return `未查询到：${query}\n请确认治具编码、厂商或治具名称是否正确。`;
  }

  const lines = [`查询关键词：${query}`, `匹配到 ${items.length} 条，最多显示前 10 条：`, ''];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.fixtureCode || '-'}`);
    lines.push(`厂商：${item.supplier || '-'}｜厂区：${item.factory || '-'}`);
    lines.push(`名称：${item.fixtureName || '-'}`);
    lines.push(`数量：${item.quantity || '-'}｜交期：${item.dueDate || '-'}｜状态：${item.currentStatus || item.outsourceStatus || '-'}`);
    if (item.designer) lines.push(`设计：${item.designer}`);
    if (item.prNo) lines.push(`PR：${item.prNo}`);
    if (item.remark) lines.push(`备注：${item.remark.slice(0, 120)}`);
    lines.push(`来源：${item.sourceSheet || '-'} 第${item.rowNumber || '-'}行`);
    lines.push('');
  });
  return lines.join('\n');
}

async function replyText(tenantToken, messageId, text) {
  const url = `${FEISHU_BASE}/im/v1/messages/${messageId}/reply`;
  const resp = await axios.post(url, {
    msg_type: 'text',
    content: JSON.stringify({ text })
  }, {
    headers: { Authorization: `Bearer ${tenantToken}` }
  });
  if (resp.data.code !== 0) throw new Error(`回复消息失败：${resp.data.msg}`);
}

function verifyToken(body) {
  const expected = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!expected) return true;
  const actual = body?.token || body?.header?.token;
  return actual === expected;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('Feishu fixture query bot is running.');
    return;
  }

  const body = req.body || {};
  if (body.type === 'url_verification' && body.challenge) {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  if (!verifyToken(body)) {
    res.status(403).json({ code: 403, msg: 'invalid verification token' });
    return;
  }

  const eventType = body?.header?.event_type;
  const event = body?.event;
  if (eventType !== 'im.message.receive_v1' || !event?.message?.message_id) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  try {
    const query = parseMessageText(event);
    const { tenantToken, data } = await loadFixturesLive();
    const matched = searchFixtures(data, query);
    const reply = formatReply(matched, query);
    await replyText(tenantToken, event.message.message_id, reply);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err.message);
    if (err.response?.data) console.error(JSON.stringify(err.response.data));
    res.status(200).json({ ok: false, msg: err.message });
  }
};
