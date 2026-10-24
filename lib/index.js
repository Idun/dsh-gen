/**
 * dsh-gen — host half.
 *
 * 「技能」= 一份可复用的指令 + 挂载的本地文档。每个技能同时注册成一个
 * runtime skill（ctx.skills），因此模型在会话里能看到技能目录、用 `skill`
 * 工具加载指令正文，并按正文里列出的绝对路径读取挂载的知识文件。
 *
 * 数据全部放在 $DSH_HOME/dsh-gen/：
 *   gens.json              技能存储
 *   knowledge/<id>/<file>  挂载的知识文件（拷贝进来，随技能一起删除）
 * 同一个目录也就是插件安装后自动创建的「dsh-gen」工作区。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

export const name = 'dsh-gen';

/**
 * `systemPrompt` carries the per-Session role injection, and `skills` the
 * catalog entries. Both are optional in a minimal composition, so they are
 * read through `ctx.get()` rather than declared as hard injects — a deployment
 * without them still gets the settings page and the workspace.
 */

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
/** Everything this plugin owns lives here; it is also the auto-created workspace. */
const ROOT_DIR = join(DSH_HOME, 'dsh-gen');
const STORE_FILE = join(ROOT_DIR, 'gens.json');
const KNOWLEDGE_DIR = join(ROOT_DIR, 'knowledge');
const WORKSPACE_TITLE = 'dsh-gen';

/** Append-only load trace (bounded): a silent boot failure still leaves a breadcrumb. */
const TRACE_FILE = join(ROOT_DIR, 'load-trace.log');
const TRACE_MAX_BYTES = 256 * 1024;
const trace = (step) => {
  try {
    mkdirSync(ROOT_DIR, { recursive: true });
    let size = 0;
    try {
      size = statSync(TRACE_FILE).size;
    } catch {
      size = 0;
    }
    if (size > TRACE_MAX_BYTES) writeFileSync(TRACE_FILE, '', 'utf8');
    writeFileSync(TRACE_FILE, `${new Date().toISOString()} ${step}\n`, { flag: 'a' });
  } catch {
    /* diagnostics must never break loading */
  }
};
trace('module evaluated');

const STORE_VERSION = 1;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES_PER_GEN = 200;

/* ─────────────────────────────────────────────────────────── store */

const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const emptyStore = () => ({ version: STORE_VERSION, gens: [], bindings: {} });

const sanitizeFileName = (raw) => {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned === '' ? `file-${Date.now().toString(36)}` : cleaned.slice(0, 180);
};

const normalizeKnowledge = (raw, genId) => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const fileName = sanitizeFileName(item.fileName ?? item.name);
    let unique = fileName;
    let n = 2;
    while (seen.has(unique.toLowerCase())) {
      const ext = extname(fileName);
      unique = `${fileName.slice(0, fileName.length - ext.length)} (${n})${ext}`;
      n += 1;
    }
    seen.add(unique.toLowerCase());
    out.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : newId('kno'),
      name: typeof item.name === 'string' && item.name !== '' ? item.name : unique,
      fileName: unique,
      path: join(KNOWLEDGE_DIR, genId, unique),
      bytes: Number.isFinite(item.bytes) ? item.bytes : 0,
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
    });
  }
  return out;
};

const normalizeGen = (raw) => {
  const id = typeof raw?.id === 'string' && raw.id !== '' ? raw.id : newId('gen');
  return {
    id,
    kind: raw?.kind === 'preset' ? 'preset' : 'skill',
    name: typeof raw?.name === 'string' ? raw.name.trim() : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
    instructions: typeof raw?.instructions === 'string' ? raw.instructions : '',
    disableKnowledge: raw?.disableKnowledge === true,
    enabled: raw?.enabled !== false,
    /**
     * `pickerHidden` keeps a skill out of the in-conversation picker without
     * deleting it: the record, its knowledge and its runtime skill all stay, so
     * hiding is reversible and never loses work.
     */
    pickerHidden: raw?.pickerHidden === true,
    knowledge: normalizeKnowledge(raw?.knowledge, id),
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
};

/**
 * `bindings` maps a live Session id to the skill that owns its role: the
 * prompt section reads this table on every assembly, so a bound session talks
 * as that skill for its whole life without touching the skill's own record.
 */
const normalizeBindings = (raw) => {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [sessionId, genId] of Object.entries(raw)) {
    if (typeof sessionId === 'string' && sessionId !== '' && typeof genId === 'string' && genId !== '') {
      out[sessionId] = genId;
    }
  }
  return out;
};

const loadStore = () => {
  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.gens)) return emptyStore();
    return {
      version: STORE_VERSION,
      gens: parsed.gens.map(normalizeGen),
      bindings: normalizeBindings(parsed.bindings),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore();
    return emptyStore();
  }
};

const persist = (store) => {
  mkdirSync(ROOT_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, STORE_FILE);
};

/* ─────────────────────────────────────────────────────────── skill projection */

const slugify = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Kebab-case skill name; Chinese-only names fall back to a stable id suffix. */
const skillNameOf = (gen, used) => {
  const base = slugify(gen.name) || `skill-${gen.id.replace(/^gen_/, '').slice(-6)}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
};

const describeBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '空文件';
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const skillContentOf = (gen) => {
  const lines = [`# ${gen.name}`, ''];
  if (gen.description.trim() !== '') lines.push(gen.description.trim(), '');
  lines.push('## 指令', '', gen.instructions.trim() === '' ? '（未填写指令，按技能说明行动。）' : gen.instructions.trim(), '');
  if (gen.disableKnowledge) {
    lines.push('## 知识库', '', '这个技能停用了知识引用：不要读取任何挂载文件。', '');
  } else if (gen.knowledge.length === 0) {
    lines.push('## 知识库', '', '这个技能没有挂载任何文件。', '');
  } else {
    lines.push(
      '## 知识库（已挂载的本地文档）',
      '',
      '回答前先按需读取下面的文件（绝对路径可直接传给 read / ops_inspect_local_file 等工具）；',
      '只读取与当前问题相关的文件，并在回答里说明依据了哪些文件。',
      '',
    );
    for (const item of gen.knowledge) {
      lines.push(`- ${item.name}（${describeBytes(item.bytes)}）`, `  路径：${item.path}`);
    }
    lines.push('');
  }
  return lines.join('\n');
};

/* ─────────────────────────────────────────────────────────── remote service */

const RPC_SERVICE = 'dshGen';
const RPC_ENDPOINTS = [
  'listGens',
  'saveGen',
  'deleteGen',
  'addKnowledge',
  'removeKnowledge',
  'openWorkspace',
  'bindSession',
  'unbindSession',
  'sessionBinding',
  'readKnowledgeFile',
  'cloneGen',
  'exportGen',
  'exportAllGens',
  'importPackage',
];

class DshGenService extends TypertRemoteService {
  constructor(ctx, runtime) {
    super(ctx, RPC_SERVICE);
    // Attach the `@Remote` markers without decorator syntax (same shape as
    // dsh-agent-persona: the descriptor lives on the prototype).
    for (const initializer of MARKER_INITIALIZERS) initializer.call(this);
    this.runtime = runtime;
  }

  async listGens() {
    try {
      return this.runtime.view();
    } catch (error) {
      return { error: `listGens failed: ${String(error?.stack ?? error)}`, gens: [] };
    }
  }

  async saveGen(input) {
    try {
      return this.runtime.save(input);
    } catch (error) {
      return { error: `saveGen failed: ${String(error?.stack ?? error)}`, gens: [] };
    }
  }

  async deleteGen(input) {
    try {
      return this.runtime.remove(input);
    } catch (error) {
      return { error: `deleteGen failed: ${String(error?.stack ?? error)}`, gens: [] };
    }
  }

  async addKnowledge(input) {
    try {
      return this.runtime.addKnowledge(input);
    } catch (error) {
      return { error: `addKnowledge failed: ${String(error?.stack ?? error)}`, gens: [] };
    }
  }

  async removeKnowledge(input) {
    try {
      return this.runtime.removeKnowledge(input);
    } catch (error) {
      return { error: `removeKnowledge failed: ${String(error?.stack ?? error)}`, gens: [] };
    }
  }

  async openWorkspace() {
    try {
      return this.runtime.openWorkspace();
    } catch (error) {
      return { error: `openWorkspace failed: ${String(error?.stack ?? error)}` };
    }
  }

  /** Bind one live Session to a skill, so its next prompts carry the role. */
  async bindSession(input) {
    try {
      return this.runtime.bindSession(input);
    } catch (error) {
      return { error: `bindSession failed: ${String(error?.stack ?? error)}` };
    }
  }

  async unbindSession(input) {
    try {
      return this.runtime.unbindSession(input);
    } catch (error) {
      return { error: `unbindSession failed: ${String(error?.stack ?? error)}` };
    }
  }

  async sessionBinding(input) {
    try {
      return this.runtime.sessionBinding(input);
    } catch (error) {
      return { error: `sessionBinding failed: ${String(error?.stack ?? error)}` };
    }
  }

  async readKnowledgeFile(input) {
    try {
      return this.runtime.readKnowledgeFile(input);
    } catch (error) {
      return { error: `readKnowledgeFile failed: ${String(error?.stack ?? error)}` };
    }
  }

  async cloneGen(input) {
    try {
      return this.runtime.cloneGen(input);
    } catch (error) {
      return { error: `cloneGen failed: ${String(error?.stack ?? error)}` };
    }
  }

  async exportGen(input) {
    try {
      return this.runtime.exportGen(input);
    } catch (error) {
      return { error: `exportGen failed: ${String(error?.stack ?? error)}` };
    }
  }

  async exportAllGens() {
    try {
      return this.runtime.exportAllGens();
    } catch (error) {
      return { error: `exportAllGens failed: ${String(error?.stack ?? error)}` };
    }
  }

  async importPackage(input) {
    try {
      return this.runtime.importPackage(input);
    } catch (error) {
      return { error: `importPackage failed: ${String(error?.stack ?? error)}` };
    }
  }
}

const MARKER_INITIALIZERS = [];
const markRemote = (target, methods) => {
  for (const method of methods) {
    Remote(target.prototype[method], {
      kind: 'method',
      name: method,
      static: false,
      private: false,
      addInitializer: (initializer) => MARKER_INITIALIZERS.push(initializer),
    });
  }
};
markRemote(DshGenService, RPC_ENDPOINTS);

/* ─────────────────────────────────────────────────────────── plugin */

export function apply(ctx) {
  const logger = ctx.logger ?? console;
  const warn = (message, error) =>
    logger.warn?.(`[dsh-gen] ${message}${error === undefined ? '' : `: ${String(error)}`}`);
  const info = (message) => logger.info?.(`[dsh-gen] ${message}`);

  trace('apply() entered');
  mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  let store = loadStore();
  /** Skill disposers keyed by gen id, so a save can replace one projection. */
  const skillDisposers = new Map();
  let workspaceReady = false;
  /** Durable id of the dsh-gen workspace, resolved by ensureWorkspace(). */
  let workspaceId = '';

  /**
   * Store freshness stamp (`mtime:size`). The store is a plain JSON file a person
   * may edit, back up or restore while the Host runs; re-reading it when the
   * stamp moves keeps the settings page and the picker from serving a stale
   * copy, and costs one `stat` per read.
   */
  const stampOf = () => {
    try {
      const info = statSync(STORE_FILE);
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      return 'missing';
    }
  };
  let storeStamp = stampOf();
  const reloadIfChanged = () => {
    const stamp = stampOf();
    if (stamp === storeStamp) return;
    storeStamp = stamp;
    const next = loadStore();
    // A write that is mid-flight (rename) can read back empty; keep the old
    // copy rather than dropping every skill on a transient stat.
    if (stamp === 'missing' && store.gens.length > 0) return;
    store = next;
    try {
      syncSkills();
    } catch (error) {
      warn('could not re-project skills after an external edit', error);
    }
  };

  const current = () => {
    reloadIfChanged();
    return store;
  };

  const commit = (next) => {
    store = next;
    persist(store);
    storeStamp = stampOf();
    syncSkills();
  };

  /* ── runtime skills: one per gen, so the agent can load instructions and
        follow the absolute paths of the mounted documents. */
  const skillsService = () => {
    try {
      return ctx.get('skills');
    } catch {
      return undefined;
    }
  };

  const disposeSkill = (id) => {
    const dispose = skillDisposers.get(id);
    if (dispose === undefined) return;
    skillDisposers.delete(id);
    try {
      dispose();
    } catch (error) {
      warn(`could not unregister skill for ${id}`, error);
    }
  };

  function syncSkills() {
    const skills = skillsService();
    if (skills === undefined || typeof skills.register !== 'function') return;
    const used = new Set();
    const live = new Set();
    for (const gen of store.gens) {
      if (gen.enabled === false) continue;
      const skillName = skillNameOf(gen, used);
      live.add(gen.id);
      // The skill name is kebab-case ASCII (the registry's grammar), so the
      // user's own name leads the description — that is what the model reads in
      // the catalog when deciding whether the skill matches the task.
      const detail =
        gen.description.trim() !== ''
          ? gen.description.trim()
          : gen.instructions.trim().slice(0, 160) || '（未填写说明）';
      const description = `「${gen.name}」${detail}`;
      try {
        disposeSkill(gen.id);
        const dispose = skills.register({
          name: skillName,
          description,
          whenToUse: gen.description.trim() === '' ? undefined : gen.description.trim(),
          content: skillContentOf(gen),
          resourceBase: { kind: 'directory', path: join(KNOWLEDGE_DIR, gen.id) },
          metadata: { source: 'dsh-gen', genId: gen.id },
        });
        skillDisposers.set(gen.id, typeof dispose === 'function' ? dispose : () => {});
        trace(`skill registered: ${skillName} (${gen.knowledge.length} knowledge file(s))`);
      } catch (error) {
        warn(`could not register skill "${skillName}"`, error);
        trace(`skill registration failed for ${skillName}: ${String(error)}`);
      }
    }
    for (const id of [...skillDisposers.keys()]) if (!live.has(id)) disposeSkill(id);
  }

  /* ── workspace: created once, reused on every later load. */
  async function ensureWorkspace() {
    try {
      mkdirSync(ROOT_DIR, { recursive: true });
      const registry = ctx.get('workspaceRegistry');
      if (registry === undefined || typeof registry.create !== 'function') return;
      const existing = registry.list?.().find((item) => item.path === ROOT_DIR);
      if (existing !== undefined) {
        workspaceReady = true;
        workspaceId = String(existing.id);
        return;
      }
      const created = await registry.create(ROOT_DIR, WORKSPACE_TITLE);
      workspaceReady = true;
      workspaceId = created === undefined ? '' : String(created.id);
      info(`workspace "${WORKSPACE_TITLE}" ready at ${ROOT_DIR}`);
    } catch (error) {
      warn('could not create the dsh-gen workspace', error);
    }
  }

  /* ── session bindings: a Session talks as the skill it was opened from.
        The section body reads the live table on every assembly, so binding a
        running Session takes effect on its next turn without a reload. */
  const genById = (id) => current().gens.find((gen) => gen.id === id);

  /** The role block one bound Session carries, or '' for an unbound one. */
  const roleTextFor = (sessionId) => {
    const genId = current().bindings?.[sessionId];
    if (genId === undefined) return '';
    const gen = genById(genId);
    if (gen === undefined || gen.enabled === false) return '';
    if (gen.kind === 'preset') {
      const lines = [`你现在使用「${gen.name}」预设与用户对话。`];
      if (gen.description.trim() !== '') lines.push('', gen.description.trim());
      lines.push('', '## 预设内容', '', gen.instructions.trim() === '' ? '（未填写预设内容）' : gen.instructions.trim());
      lines.push('', '始终遵循该预设进行回答。');
      return lines.join('\n');
    }
    const lines = [`你现在以「${gen.name}」这个技能的身份与用户对话。`];
    if (gen.description.trim() !== '') lines.push('', gen.description.trim());
    lines.push('', '## 技能指令', '', gen.instructions.trim() === '' ? '（未填写指令，按技能说明行动。）' : gen.instructions.trim());
    if (!gen.disableKnowledge && gen.knowledge.length > 0) {
      lines.push('', '## 技能知识库', '', '回答前按需读取下列文件（绝对路径可直接传给文件工具）：');
      for (const item of gen.knowledge) lines.push(`- ${item.name}（${describeBytes(item.bytes)}）：${item.path}`);
    }
    lines.push('', '始终以这个身份回答，不要说明自己是按哪个技能的设定在说话。');
    return lines.join('\n');
  };

  const bindSession = (input) => {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    const genId = typeof input?.genId === 'string' ? input.genId : '';
    if (sessionId === '') throw new Error('缺少会话 id');
    if (genId === '') throw new Error('缺少技能 id');
    if (genById(genId) === undefined) throw new Error('技能不存在（可能已被删除）');
    const next = loadStore();
    next.bindings = { ...(next.bindings ?? {}), [sessionId]: genId };
    commit(next);
    return view();
  };

  const unbindSession = (input) => {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    if (sessionId === '') throw new Error('缺少会话 id');
    const next = loadStore();
    if (next.bindings?.[sessionId] !== undefined) {
      const bindings = { ...next.bindings };
      delete bindings[sessionId];
      next.bindings = bindings;
      commit(next);
    }
    return view();
  };

  const sessionBinding = (input) => {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    const genId = sessionId === '' ? undefined : current().bindings?.[sessionId];
    const gen = genId === undefined ? undefined : genById(genId);
    return {
      sessionId,
      genId: gen?.id ?? null,
      genName: gen?.name ?? null,
      workspaceId: workspaceId === '' ? null : workspaceId,
      workspacePath: ROOT_DIR,
    };
  };


  /* ── view / mutations */
  const view = () => {
    const used = new Set();
    return {
      version: STORE_VERSION,
      root: ROOT_DIR,
      storePath: STORE_FILE,
      knowledgeRoot: KNOWLEDGE_DIR,
      workspacePath: ROOT_DIR,
      workspaceReady,
      skillsAvailable: skillsService() !== undefined,
      gens: current().gens.map((gen) => {
        const skillName = skillNameOf(gen, used);
        return {
          ...gen,
          skillName,
          knowledgeCount: gen.knowledge.length,
          knowledgeBytes: gen.knowledge.reduce((sum, item) => sum + item.bytes, 0),
        };
      }),
    };
  };

  const save = (input) => {
    const next = loadStore();
    const id = typeof input?.id === 'string' && input.id !== '' ? input.id : undefined;
    const existing = id !== undefined ? next.gens.find((item) => item.id === id) : undefined;
    const kind = input?.kind === 'preset' || input?.kind === 'skill'
      ? input.kind
      : (existing?.kind === 'preset' ? 'preset' : 'skill');
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name === '') throw new Error(kind === 'preset' ? '请先为预设命名' : '请先为技能命名');
    const patch = {
      kind,
      name,
      description: typeof input?.description === 'string' ? input.description : '',
      instructions: typeof input?.instructions === 'string' ? input.instructions : '',
      disableKnowledge: kind === 'preset' ? true : input?.disableKnowledge === true,
      enabled: input?.enabled !== false,
      updatedAt: new Date().toISOString(),
    };
    // The editor never sends this field; the card's eye button does, and leaving
    // it undefined here is what keeps an ordinary save from resetting the switch.
    if (typeof input?.pickerHidden === 'boolean') patch.pickerHidden = input.pickerHidden;
    let gen;
    if (id === undefined) {
      gen = normalizeGen({ ...patch, id: newId('gen'), knowledge: [], createdAt: patch.updatedAt });
      mkdirSync(join(KNOWLEDGE_DIR, gen.id), { recursive: true });
      next.gens.unshift(gen);
    } else {
      gen = next.gens.find((item) => item.id === id);
      if (gen === undefined) throw new Error('技能不存在（可能已被删除）');
      Object.assign(gen, patch);
    }
    // Knowledge rides the same transaction as the text fields: the editor can
    // attach documents before the skill has ever been saved.
    const dropped = Array.isArray(input?.removedKnowledgeIds) ? input.removedKnowledgeIds : [];
    const droppedPaths = [];
    if (dropped.length > 0) {
      gen.knowledge = gen.knowledge.filter((item) => {
        if (!dropped.includes(item.id)) return true;
        droppedPaths.push(item.path);
        return false;
      });
    }
    const skipped = attachFiles(gen, Array.isArray(input?.files) ? input.files : []);
    commit(next);
    for (const path of droppedPaths) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch (error) {
        warn(`could not delete ${path}`, error);
      }
    }
    info(`saved skill "${name}"`);
    const result = view();
    if (skipped.length > 0) result.notice = `已跳过：${skipped.join('；')}`;
    return result;
  };

  /**
   * Copy base64 payloads into the skill's knowledge directory and append the
   * records. Shared by `save` (draft attachments) and `addKnowledge` (the
   * post-save top-up path). Returns the skipped-file reasons.
   */
  function attachFiles(gen, files) {
    const skipped = [];
    if (files.length === 0) return skipped;
    const dir = join(KNOWLEDGE_DIR, gen.id);
    mkdirSync(dir, { recursive: true });
    for (const file of files) {
      if (gen.knowledge.length >= MAX_FILES_PER_GEN) {
        skipped.push(`${file?.name ?? '文件'}（超出 ${MAX_FILES_PER_GEN} 个上限）`);
        continue;
      }
      const encoded = typeof file?.data === 'string' ? file.data : '';
      if (encoded === '') {
        skipped.push(`${file?.name ?? '文件'}（内容为空）`);
        continue;
      }
      let bytes;
      try {
        bytes = Buffer.from(encoded, 'base64');
      } catch {
        skipped.push(`${file?.name ?? '文件'}（内容无法解码）`);
        continue;
      }
      if (bytes.length > MAX_FILE_BYTES) {
        skipped.push(`${file?.name ?? '文件'}（超过 ${describeBytes(MAX_FILE_BYTES)}）`);
        continue;
      }
      const fileName = sanitizeFileName(file?.name);
      const existing = new Set(gen.knowledge.map((item) => item.fileName.toLowerCase()));
      let unique = fileName;
      let n = 2;
      while (existing.has(unique.toLowerCase())) {
        const ext = extname(fileName);
        unique = `${fileName.slice(0, fileName.length - ext.length)} (${n})${ext}`;
        n += 1;
      }
      const target = join(dir, unique);
      writeFileSync(target, bytes);
      gen.knowledge.push({
        id: newId('kno'),
        name: unique,
        fileName: unique,
        path: target,
        bytes: bytes.length,
        addedAt: new Date().toISOString(),
      });
    }
    if (gen.knowledge.length > 0) gen.updatedAt = new Date().toISOString();
    return skipped;
  }

  const remove = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const next = loadStore();
    const before = next.gens.length;
    next.gens = next.gens.filter((gen) => gen.id !== id);
    if (next.gens.length === before) throw new Error('技能不存在（可能已被删除）');
    // Sessions bound to the deleted skill fall back to the stock prompt.
    const bindings = {};
    for (const [sessionId, genId] of Object.entries(next.bindings ?? {})) {
      if (genId !== id) bindings[sessionId] = genId;
    }
    next.bindings = bindings;
    commit(next);
    try {
      rmSync(join(KNOWLEDGE_DIR, id), { recursive: true, force: true });
    } catch (error) {
      warn(`could not delete knowledge of ${id}`, error);
    }
    info(`deleted skill ${id}`);
    return view();
  };

  const addKnowledge = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const files = Array.isArray(input?.files) ? input.files : [];
    if (files.length === 0) throw new Error('没有选择文件');
    const next = loadStore();
    const gen = next.gens.find((item) => item.id === id);
    if (gen === undefined) throw new Error('技能不存在（可能已被删除）');
    const before = gen.knowledge.length;
    const skipped = attachFiles(gen, files);
    commit(next);
    info(`attached ${gen.knowledge.length - before} file(s) to ${gen.name}`);
    const result = view();
    if (skipped.length > 0) result.notice = `已跳过：${skipped.join('；')}`;
    return result;
  };

  const removeKnowledge = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const fileId = typeof input?.fileId === 'string' ? input.fileId : '';
    const next = loadStore();
    const gen = next.gens.find((item) => item.id === id);
    if (gen === undefined) throw new Error('技能不存在（可能已被删除）');
    const target = gen.knowledge.find((item) => item.id === fileId);
    if (target === undefined) throw new Error('文件不存在（可能已被删除）');
    gen.knowledge = gen.knowledge.filter((item) => item.id !== fileId);
    gen.updatedAt = new Date().toISOString();
    commit(next);
    try {
      if (existsSync(target.path) && statSync(target.path).isFile()) unlinkSync(target.path);
    } catch (error) {
      warn(`could not delete ${target.path}`, error);
    }
    return view();
  };

  const openWorkspace = () => {
    let registry;
    try {
      registry = ctx.get('workspaceRegistry');
    } catch {
      registry = undefined;
    }
    const workspace = registry?.list?.().find((item) => item.path === ROOT_DIR);
    return {
      workspaceId: workspace === undefined ? null : String(workspace.id),
      path: ROOT_DIR,
      title: WORKSPACE_TITLE,
    };
  };

  /**
   * Resolve a knowledge record to a file that actually exists.
   *
   * A record's `path` is absolute and can go stale for reasons the plugin never
   * sees: the user moved the data directory, restored `gens.json` from a backup
   * taken on another machine, or deleted a file behind the plugin's back. Rather
   * than failing the read, fall back to the skill's own knowledge directory and
   * match by file name — and when that succeeds, write the corrected path back
   * so the next read is a plain hit.
   *
   * Returns the path, or `undefined` when the file is genuinely gone.
   */
  const resolveKnowledgePath = (gen, item) => {
    if (typeof item?.path === 'string' && item.path !== '' && existsSync(item.path)) return item.path;
    const dir = join(KNOWLEDGE_DIR, gen.id);
    if (!existsSync(dir)) return undefined;
    const wanted = [item?.fileName, item?.name]
      .filter((value) => typeof value === 'string' && value !== '')
      .map((value) => value.split(/[\\/]/).pop());
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }
    const hit = entries.find((entry) => wanted.includes(entry));
    if (hit === undefined) return undefined;
    const repaired = join(dir, hit);
    // Persist the repair so this costs one directory scan, once.
    try {
      const next = loadStore();
      const target = next.gens.find((entry) => entry.id === gen.id);
      const record = target?.knowledge.find((entry) => entry.id === item.id);
      if (record !== undefined && record.path !== repaired) {
        record.path = repaired;
        commit(next);
      }
    } catch (error) {
      warn(`could not persist the repaired path for ${item.id}`, error);
    }
    return repaired;
  };

  const readKnowledgeFile = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const fileId = typeof input?.fileId === 'string' ? input.fileId : '';
    const gen = current().gens.find((item) => item.id === id);
    if (gen === undefined) throw new Error('技能不存在');
    const target = gen.knowledge.find((item) => item.id === fileId);
    if (target === undefined) throw new Error('文件未找到');
    const path = resolveKnowledgePath(gen, target);
    if (path === undefined) {
      throw new Error(`磁盘文件不存在：${target.fileName ?? target.name}（可能已被移动或删除）`);
    }
    const stat = statSync(path);
    const MAX_PREVIEW_BYTES = 128 * 1024;
    const isTruncated = stat.size > MAX_PREVIEW_BYTES;
    const readLength = Math.min(stat.size, MAX_PREVIEW_BYTES);
    const buffer = Buffer.alloc(readLength);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, readLength, 0);
    } finally {
      closeSync(fd);
    }

    let isBinary = false;
    for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    return {
      id: target.id,
      fileName: target.fileName,
      name: target.name,
      bytes: target.bytes,
      totalBytes: stat.size,
      truncated: isTruncated,
      isBinary,
      content: isBinary ? '' : buffer.toString('utf8'),
    };
  };

  const cloneGen = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const next = loadStore();
    const source = next.gens.find((g) => g.id === id);
    if (source === undefined) throw new Error('源技能不存在');
    const newGenId = newId('gen');
    const targetDir = join(KNOWLEDGE_DIR, newGenId);
    mkdirSync(targetDir, { recursive: true });

    const newKnowledge = [];
    for (const item of source.knowledge) {
      const uniqueFileName = item.fileName;
      const targetPath = join(targetDir, uniqueFileName);
      // A stale source path must not silently clone an empty record: resolve it
      // the same way a read does, and skip the entry entirely when the bytes are
      // gone so the copy has no phantom files.
      const sourcePath = resolveKnowledgePath(source, item);
      if (sourcePath === undefined) {
        warn(`skipping ${item.fileName} during clone: the file is gone`);
        continue;
      }
      try {
        copyFileSync(sourcePath, targetPath);
      } catch (error) {
        warn(`could not copy file ${sourcePath} during clone`, error);
        continue;
      }
      newKnowledge.push({
        id: newId('kno'),
        name: item.name,
        fileName: uniqueFileName,
        path: targetPath,
        bytes: item.bytes,
        addedAt: new Date().toISOString(),
      });
    }

    const isPreset = source.kind === 'preset';
    const cloned = {
      ...source,
      id: newGenId,
      kind: isPreset ? 'preset' : 'skill',
      name: `${source.name} 副本`,
      knowledge: newKnowledge,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    next.gens.unshift(cloned);
    commit(next);
    info(`cloned ${isPreset ? 'preset' : 'skill'} "${source.name}" to "${cloned.name}"`);
    return view();
  };

  const exportGen = (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    const gen = current().gens.find((g) => g.id === id);
    if (gen === undefined) throw new Error('技能或预设不存在');
    const files = [];
    for (const item of gen.knowledge) {
      let data = '';
      try {
        if (existsSync(item.path)) {
          data = readFileSync(item.path).toString('base64');
        }
      } catch (error) {
        warn(`could not read knowledge file ${item.path} for export`, error);
      }
      files.push({
        name: item.name,
        fileName: item.fileName,
        bytes: item.bytes,
        data,
      });
    }
    return {
      version: 1,
      type: 'dsh-gen-skill',
      exportedAt: new Date().toISOString(),
      gen: {
        kind: gen.kind ?? 'skill',
        name: gen.name,
        description: gen.description,
        instructions: gen.instructions,
        disableKnowledge: gen.disableKnowledge === true,
        files,
      },
    };
  };

  const exportAllGens = () => {
    const list = current().gens;
    const exportedGens = [];
    const missing = [];
    for (const gen of list) {
      const files = [];
      for (const item of gen.knowledge) {
        let data = '';
        try {
          // Same repair path as reading: a stale absolute path is not a reason to
          // export an empty file when the bytes are sitting in the skill's own
          // knowledge directory.
          const path = resolveKnowledgePath(gen, item);
          if (path !== undefined) data = readFileSync(path).toString('base64');
          else missing.push(`${gen.name}/${item.fileName ?? item.name}`);
        } catch (error) {
          warn(`could not read knowledge file ${item.path} for export`, error);
          missing.push(`${gen.name}/${item.fileName ?? item.name}`);
        }
        files.push({
          name: item.name,
          fileName: item.fileName,
          bytes: item.bytes,
          data,
        });
      }
      exportedGens.push({
        kind: gen.kind ?? 'skill',
        name: gen.name,
        description: gen.description,
        instructions: gen.instructions,
        disableKnowledge: gen.disableKnowledge === true,
        pickerHidden: gen.pickerHidden === true,
        files,
      });
    }
    return {
      version: 1,
      type: 'dsh-gen-backup',
      exportedAt: new Date().toISOString(),
      gens: exportedGens,
      /** Files whose bytes could not be found; the entry is still exported. */
      missing,
    };
  };

  const importPackage = (input) => {
    const raw = input?.packageData;
    if (raw === null || typeof raw !== 'object') throw new Error('导入数据格式不正确');
    const next = loadStore();
    let importedCount = 0;

    if (raw.type === 'dsh-gen-skill' && raw.gen !== null && typeof raw.gen === 'object') {
      const genData = raw.gen;
      const isPreset = genData.kind === 'preset';
      const defaultName = isPreset ? '已导入预设' : '已导入技能';
      const genName =
        typeof genData.name === 'string' && genData.name.trim() !== '' ? genData.name.trim() : defaultName;
      const genId = newId(isPreset ? 'pre' : 'gen');
      const gen = normalizeGen({
        id: genId,
        kind: isPreset ? 'preset' : 'skill',
        name: genName,
        description: typeof genData.description === 'string' ? genData.description : '',
        instructions: typeof genData.instructions === 'string' ? genData.instructions : '',
        disableKnowledge: isPreset ? true : genData.disableKnowledge === true,
        enabled: true,
        pickerHidden: false,
        knowledge: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      mkdirSync(join(KNOWLEDGE_DIR, gen.id), { recursive: true });
      if (Array.isArray(genData.files)) {
        attachFiles(gen, genData.files);
      }
      next.gens.unshift(gen);
      importedCount = 1;
    } else if (raw.type === 'dsh-gen-backup' && Array.isArray(raw.gens)) {
      for (const genData of raw.gens) {
        if (genData === null || typeof genData !== 'object' || typeof genData.name !== 'string') continue;
        const isPreset = genData.kind === 'preset';
        const genId = newId(isPreset ? 'pre' : 'gen');
        const defaultName = isPreset ? '已导入预设' : '已导入技能';
        const gen = normalizeGen({
          id: genId,
          kind: isPreset ? 'preset' : 'skill',
          name: genData.name.trim() || defaultName,
          description: typeof genData.description === 'string' ? genData.description : '',
          instructions: typeof genData.instructions === 'string' ? genData.instructions : '',
          disableKnowledge: isPreset ? true : genData.disableKnowledge === true,
          pickerHidden: genData.pickerHidden === true,
          enabled: true,
          knowledge: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        mkdirSync(join(KNOWLEDGE_DIR, gen.id), { recursive: true });
        if (Array.isArray(genData.files)) {
          attachFiles(gen, genData.files);
        }
        next.gens.unshift(gen);
        importedCount += 1;
      }
    } else {
      throw new Error('不支持的包格式');
    }

    commit(next);
    info(`imported ${importedCount} skill(s) from package`);
    const result = view();
    result.notice = `成功导入 ${importedCount} 个技能`;
    return result;
  };

  /* ── mount */
  try {
    new DshGenService(ctx, {
      view,
      save,
      remove,
      addKnowledge,
      removeKnowledge,
      openWorkspace,
      bindSession,
      unbindSession,
      sessionBinding,
      readKnowledgeFile,
      cloneGen,
      exportGen,
      exportAllGens,
      importPackage,
    });
    info(`remote namespace "${RPC_SERVICE}" registered`);
  } catch (error) {
    warn(`could not register the ${RPC_SERVICE} service`, error);
  }

  // Role injection: one global section whose body is empty for unbound
  // Sessions. Reading the binding table per assembly is what lets a running
  // Session switch skills without recreating it.
  const promptService = (() => {
    try {
      return ctx.get('systemPrompt');
    } catch {
      return undefined;
    }
  })();
  if (promptService === undefined) {
    trace('systemPrompt service absent — role injection disabled');
  } else {
    try {
      const order = promptService.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 2;
      ctx.effect(
        () =>
          promptService.section({
            name: 'dsh-gen-role',
            order,
            text: (assembly) => {
              const agent = assembly?.agent;
              const sessionId = agent?.session?.header?.id ?? agent?.id;
              return typeof sessionId === 'string' && sessionId !== '' ? roleTextFor(sessionId) : '';
            },
          }),
        'dsh-gen: role section',
      );
      info(`role section registered at order ${order}`);
      trace(`role section registered at order ${order}`);
    } catch (error) {
      warn('could not register the role prompt section', error);
      trace(`role section failed: ${String(error)}`);
    }
  }

  try {
    syncSkills();
    trace(`skills synced (service=${skillsService() === undefined ? 'absent' : 'present'}, gens=${store.gens.length})`);
  } catch (error) {
    warn('could not project skills', error);
    trace(`skills sync failed: ${String(error)}`);
  }

  // The workspace needs the registry to be up; retry briefly while it settles.
  let disposed = false;
  const mountWorkspace = async (attempt = 0) => {
    if (disposed) return;
    await ensureWorkspace();
    if (disposed || workspaceReady) return;
    if (attempt >= 40) return;
    setTimeout(() => void mountWorkspace(attempt + 1), 250);
  };
  void mountWorkspace();

  ctx.effect(() => () => {
    disposed = true;
    for (const id of [...skillDisposers.keys()]) disposeSkill(id);
  }, 'dsh-gen: teardown');

  info(`store ${STORE_FILE} (${store.gens.length} skill(s))`);
}
