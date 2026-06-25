// Read-only client for the Idenstr local relay (the write-ahead vault).
// Idenstr signs and stores every event in this relay first; Workstr reads it back.
// We never write: the relay is pinned to the owner key, so this is read-only by
// construction and needs no token scope (the vault is read-open on the mesh/LAN).

const DEFAULT_TIMEOUT_MS = 4000;

export function vaultUrl() {
  return process.env.WORKSTR_LOCAL_RELAY ?? '';
}

export async function readEvents({ kinds = [30078], limit = 200, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = vaultUrl();
  if (!url) return { configured: false, events: [] };
  return new Promise((resolve) => {
    const events = [];
    let socket = null;
    let settled = false;
    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket && socket.close(); } catch {}
      resolve({ configured: true, url, events, ...extra });
    };
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    try {
      socket = new WebSocket(url);
    } catch (err) {
      return finish({ error: err.message });
    }
    const subId = `workstr-${Math.random().toString(36).slice(2, 10)}`;
    socket.addEventListener('open', () => socket.send(JSON.stringify(['REQ', subId, { kinds, limit }])));
    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); } catch { return; }
      if (msg[0] === 'EVENT' && msg[1] === subId) events.push(msg[2]);
      else if (msg[0] === 'EOSE' && msg[1] === subId) finish();
    });
    socket.addEventListener('error', () => finish({ error: 'relay connection error' }));
    socket.addEventListener('close', () => finish());
  });
}

// Decode the workout sheets currently stored in the vault (kind 30078, workstr).
export async function readSheets() {
  const { configured, events, error, timedOut, url } = await readEvents({ kinds: [30078] });
  const sheets = (events || [])
    .filter((e) => (e.tags || []).some((t) => t[0] === 'd' && String(t[1]).startsWith('workstr:sheet:')))
    .map((e) => {
      let content = {};
      try { content = JSON.parse(e.content); } catch {}
      const dTag = (e.tags.find((t) => t[0] === 'd') || [])[1] || '';
      const title = (e.tags.find((t) => t[0] === 'title') || [])[1] || content.name || '(untitled)';
      return { id: e.id, address: `30078:${dTag}`, title, exercises: (content.exercises || []).length, createdAt: e.created_at };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  return { configured, url, error, timedOut, sheets };
}
