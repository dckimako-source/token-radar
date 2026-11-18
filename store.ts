import { createHash } from 'node:crypto';

export const SCENARIO_EPOCH_SEC = 1_735_689_600;
export const DEFAULT_BRANCH = 'main';
export const VIEWER_LOGIN = 'adaiversen';
export const VIEWER_NAME = 'ada iversen';
export const VIEWER_EMAIL = 'adaiversen@example.invalid';

export interface User {
  id: number;
  node_id: string;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  type: 'User';
  created_at: string;
}

export interface Label {
  id: number;
  node_id: string;
  name: string;
  color: string;
  default: boolean;
  description: string | null;
}

export interface IssueComment {
  id: number;
  node_id: string;
  body: string;
  user: User;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: Label[];
  user: User;
  comments: IssueComment[];
  created_at: string;
  updated_at: string;
}

export interface PullRef {
  ref: string;
  sha: string;
  label: string;
  user: User;
}

export interface PullRequest {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: PullRef;
  base: PullRef;
  user: User;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: number;
  node_id: string;
  name: string;
  owner: string;
  description: string;
  private: boolean;
  default_branch: string;
  created_at: string;
  updated_at: string;
  issues: Map<number, Issue>;
  labels: Map<string, Label>;
  pulls: Map<number, PullRequest>;
  refs: Map<string, string>;
  counters: { issue: number; pull: number };
}

export type GitObjectType = 'blob' | 'tree' | 'commit';

export interface GitObject {
  type: GitObjectType;
  content: Buffer;
  raw: Buffer;
}

export interface ParsedCommit {
  sha: string;
  tree: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  epochSec: number;
  message: string;
}

export interface TreeEntry {
  mode: string;
  name: string;
  sha: string;
}

export interface PathEntry {
  kind: 'file' | 'dir';
  mode: string;
  sha: string;
  content?: Buffer;
}

export class DeterministicClock {
  private seconds: number;

  constructor(start: number = SCENARIO_EPOCH_SEC) {
    this.seconds = start;
  }

  tick(): number {
    const value = this.seconds;
    this.seconds += 1;
    return value;
  }

  iso(): string {
    return new Date(this.tick() * 1000).toISOString();
  }
}

function isoOf(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString();
}

function lower(value: string): string {
  return value.toLowerCase();
}

export class Store {
  readonly clock = new DeterministicClock();
  readonly users = new Map<string, User>();
  readonly objects = new Map<string, GitObject>();
  readonly repos = new Map<string, Repo>();
  readonly viewer: User;
  private readonly byOwner = new Map<string, Repo[]>();
  private readonly commitCache = new Map<string, ParsedCommit>();
  private nextRepoId = 5000;
  private nextIssueId = 1;
  private nextLabelId = 1;
  private nextCommentId = 1;
  private nextPullId = 1;

  constructor() {
    this.viewer = this.createUser(VIEWER_LOGIN, VIEWER_NAME, VIEWER_EMAIL);
  }

  private createUser(login: string, name: string, email: string): User {
    const id = 1000 + this.users.size;
    const user: User = {
      id,
      node_id: `U_${id}`,
      login,
      name,
      email,
      avatar_url: `https://avatars.example.invalid/u/${id}`,
      type: 'User',
      created_at: this.clock.iso(),
    };
    this.users.set(login, user);
    return user;
  }

  repoKey(owner: string, name: string): string {
    return `${lower(owner)}/${lower(name)}`;
  }

  getRepo(owner: string, name: string): Repo | undefined {
    return this.repos.get(this.repoKey(owner, name));
  }

  listRepos(owner: string): Repo[] {
    return this.byOwner.get(lower(owner)) ?? [];
  }

  createRepo(owner: string, name: string, options: { description?: string; private?: boolean; default_branch?: string } = {}): Repo {
    const key = this.repoKey(owner, name);
    const existing = this.repos.get(key);
    if (existing !== undefined) return existing;
    const id = this.nextRepoId;
    this.nextRepoId += 1;
    const now = this.clock.iso();
    const repo: Repo = {
      id,
      node_id: `R_${id}`,
      name,
      owner,
      description: options.description ?? '',
      private: options.private ?? false,
      default_branch: options.default_branch ?? DEFAULT_BRANCH,
      created_at: now,
      updated_at: now,
      issues: new Map(),
      labels: new Map(),
      pulls: new Map(),
      refs: new Map(),
      counters: { issue: 0, pull: 0 },
    };
    this.repos.set(key, repo);
    const owned = this.byOwner.get(lower(owner)) ?? [];
    owned.push(repo);
    this.byOwner.set(lower(owner), owned);
    return repo;
  }

  deleteRepo(owner: string, name: string): boolean {
    const key = this.repoKey(owner, name);
    if (!this.repos.delete(key)) return false;
    const owned = this.byOwner.get(lower(owner));
    if (owned !== undefined) {
      const index = owned.findIndex((repo) => lower(repo.name) === lower(name));
      if (index >= 0) owned.splice(index, 1);
    }
    return true;
  }

  createLabel(repo: Repo, name: string, color = 'ededed', description: string | null = null): Label {
    const existing = repo.labels.get(lower(name));
    if (existing !== undefined) return existing;
    const id = this.nextLabelId;
    this.nextLabelId += 1;
    const label: Label = {
      id,
      node_id: `LA_${id}`,
      name,
      color,
      default: false,
      description,
    };
    repo.labels.set(lower(name), label);
    return label;
  }

  createIssue(repo: Repo, title: string, body: string, labels: Label[]): Issue {
    repo.counters.issue += 1;
    const id = this.nextIssueId;
    this.nextIssueId += 1;
    const now = this.clock.iso();
    const issue: Issue = {
      id,
      node_id: `I_${id}`,
      number: repo.counters.issue,
      title,
      body,
      state: 'open',
      labels,
      user: this.viewer,
      comments: [],
      created_at: now,
      updated_at: now,
    };
    repo.issues.set(issue.number, issue);
    return issue;
  }

  createComment(repo: Repo, issue: Issue, body: string): IssueComment {
    const id = this.nextCommentId;
    this.nextCommentId += 1;
    const now = this.clock.iso();
    const comment: IssueComment = {
      id,
      node_id: `IC_${id}`,
      body,
      user: this.viewer,
      created_at: now,
      updated_at: now,
    };
    issue.comments.push(comment);
    issue.updated_at = now;
    return comment;
  }

  createPull(repo: Repo, options: { title: string; body: string; head: string; base: string; headSha: string; baseSha: string }): PullRequest {
    repo.counters.pull += 1;
    const id = this.nextPullId;
    this.nextPullId += 1;
    const now = this.clock.iso();
    const pull: PullRequest = {
      id,
      node_id: `PR_${id}`,
      number: repo.counters.pull,
      title: options.title,
      body: options.body,
      state: 'open',
      merged: false,
      merged_at: null,
      merge_commit_sha: null,
      head: { ref: options.head, sha: options.headSha, label: `${repo.owner}:${options.head}`, user: this.viewer },
      base: { ref: options.base, sha: options.baseSha, label: `${repo.owner}:${options.base}`, user: this.viewer },
      user: this.viewer,
      created_at: now,
      updated_at: now,
    };
    repo.pulls.set(pull.number, pull);
    return pull;
  }

  hashObject(type: GitObjectType, content: Buffer): string {
    const header = Buffer.from(`${type} ${content.length}\0`, 'utf8');
    const raw = Buffer.concat([header, content]);
    const sha = createHash('sha1').update(raw).digest('hex');
    if (!this.objects.has(sha)) this.objects.set(sha, { type, content, raw });
    return sha;
  }

  writeBlob(content: Buffer | string): string {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    return this.hashObject('blob', bytes);
  }

  readObject(sha: string): GitObject | undefined {
    return this.objects.get(lower(sha));
  }

  private writeTreeEntries(entries: TreeEntry[]): string {
    const sorted = entries.slice().sort((a, b) => {
      const left = Buffer.from(`${a.name}${a.mode.startsWith('4') ? '/' : ''}`, 'utf8');
      const right = Buffer.from(`${b.name}${b.mode.startsWith('4') ? '/' : ''}`, 'utf8');
      return Buffer.compare(left, right);
    });
    const parts: Buffer[] = [];
    for (const entry of sorted) {
      parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'));
      parts.push(Buffer.from(entry.sha, 'hex'));
    }
    return this.hashObject('tree', Buffer.concat(parts));
  }

  buildTree(files: Map<string, Buffer>): string {
    type Dir = Map<string, Buffer | Dir>;
    const root: Dir = new Map();
    for (const [rawPath, content] of files) {
      const parts = rawPath.split('/').filter((part) => part !== '');
      if (parts.length === 0) continue;
      let node = root;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index] as string;
        const next = node.get(part);
        if (next instanceof Map) node = next;
        else {
          const created: Dir = new Map();
          node.set(part, created);
          node = created;
        }
      }
      node.set(parts[parts.length - 1] as string, content);
    }
    const writeNode = (node: Dir): string => {
      const entries: TreeEntry[] = [];
      for (const [name, value] of node) {
        if (value instanceof Map) entries.push({ mode: '40000', name, sha: writeNode(value) });
        else entries.push({ mode: '100644', name, sha: this.writeBlob(value) });
      }
      return this.writeTreeEntries(entries);
    };
    return writeNode(root);
  }

  createCommit(
    files: Map<string, Buffer>,
    options: { message: string; parent?: string | null; author?: { name: string; email: string }; timestamp?: number },
  ): string {
    const tree = this.buildTree(files);
    const epochSec = options.timestamp ?? this.clock.tick();
    const author = options.author ?? { name: this.viewer.name, email: this.viewer.email };
    const message = options.message.replace(/\n+$/, '');
    const lines: string[] = [`tree ${tree}`];
    if (options.parent !== undefined && options.parent !== null && options.parent !== '') lines.push(`parent ${options.parent}`);
    lines.push(`author ${author.name} <${author.email}> ${epochSec} +0000`);
    lines.push(`committer ${author.name} <${author.email}> ${epochSec} +0000`);
    lines.push('', `${message}\n`);
    const content = Buffer.from(lines.join('\n'), 'utf8');
    return this.hashObject('commit', content);
  }

  readTreeEntries(treeSha: string): TreeEntry[] {
    const object = this.readObject(treeSha);
    if (object === undefined || object.type !== 'tree') return [];
    const content = object.content;
    const out: TreeEntry[] = [];
    let position = 0;
    while (position < content.length) {
      const space = content.indexOf(0x20, position);
      if (space < 0) break;
      const nul = content.indexOf(0, space + 1);
      if (nul < 0 || nul + 21 > content.length) break;
      const mode = content.subarray(position, space).toString('utf8');
      const name = content.subarray(space + 1, nul).toString('utf8');
      const sha = content.subarray(nul + 1, nul + 21).toString('hex');
      out.push({ mode, name, sha });
      position = nul + 21;
    }
    return out;
  }

  getCommit(sha: string): ParsedCommit | null {
    const key = lower(sha);
    const cached = this.commitCache.get(key);
    if (cached !== undefined) return cached;
    const object = this.readObject(key);
    if (object === undefined || object.type !== 'commit') return null;
    const text = object.content.toString('utf8');
    const split = text.indexOf('\n\n');
    const header = split < 0 ? text : text.slice(0, split);
    const body = split < 0 ? '' : text.slice(split + 2);
    let tree = '';
    const parents: string[] = [];
    let authorName = '';
    let authorEmail = '';
    let committerName = '';
    let committerEmail = '';
    let epochSec = 0;
    for (const line of header.split('\n')) {
      if (line.startsWith('tree ')) tree = line.slice(5).trim();
      else if (line.startsWith('parent ')) parents.push(line.slice(7).trim());
      else if (line.startsWith('author ') || line.startsWith('committer ')) {
        const match = /^(.*) <(.*)> (\d+) [+-]\d{4}$/.exec(line);
        if (match !== null) {
          const name = match[1] ?? '';
          const email = match[2] ?? '';
          const seconds = Number(match[3] ?? '0');
          if (line.startsWith('author ')) {
            authorName = name;
            authorEmail = email;
            epochSec = seconds;
          } else {
            committerName = name;
            committerEmail = email;
          }
        }
      }
    }
    const parsed: ParsedCommit = {
      sha: key,
      tree,
      parents,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      epochSec,
      message: body.replace(/\n$/, ''),
    };
    this.commitCache.set(key, parsed);
    return parsed;
  }

  resolveRef(repo: Repo, ref: string): string | null {
    const value = ref.trim();
    if (value === '') return null;
    if (/^[0-9a-f]{40}$/i.test(value)) {
      const commit = this.getCommit(value);
      return commit === null ? null : commit.sha;
    }
    const direct = repo.refs.get(value);
    if (direct !== undefined) return direct;
    if (value.startsWith('refs/')) {
      const found = repo.refs.get(value);
      return found ?? null;
    }
    return repo.refs.get(`refs/heads/${value}`) ?? repo.refs.get(`refs/tags/${value}`) ?? null;
  }

  resolveCommit(repo: Repo, ref: string): ParsedCommit | null {
    const sha = this.resolveRef(repo, ref);
    return sha === null ? null : this.getCommit(sha);
  }

  readFilesAtTree(treeSha: string, prefix = '', out = new Map<string, Buffer>()): Map<string, Buffer> {
    for (const entry of this.readTreeEntries(treeSha)) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode.startsWith('4')) this.readFilesAtTree(entry.sha, path, out);
      else {
        const object = this.readObject(entry.sha);
        if (object !== undefined && object.type === 'blob') out.set(path, object.content);
      }
    }
    return out;
  }

  readFilesAtRef(repo: Repo, ref: string): Map<string, Buffer> {
    const commit = this.resolveCommit(repo, ref);
    return commit === null ? new Map() : this.readFilesAtTree(commit.tree);
  }

  resolvePath(repo: Repo, ref: string, path: string): PathEntry | null {
    const commit = this.resolveCommit(repo, ref);
    if (commit === null) return null;
    const parts = path.split('/').filter((part) => part !== '');
    if (parts.length === 0) return { kind: 'dir', mode: '40000', sha: commit.tree };
    let current = commit.tree;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as string;
      const entry = this.readTreeEntries(current).find((candidate) => candidate.name === part);
      if (entry === undefined) return null;
      const isDir = entry.mode.startsWith('4');
      if (index === parts.length - 1) {
        if (isDir) return { kind: 'dir', mode: entry.mode, sha: entry.sha };
        const object = this.readObject(entry.sha);
        return { kind: 'file', mode: entry.mode, sha: entry.sha, content: object?.content ?? Buffer.alloc(0) };
      }
      if (!isDir) return null;
      current = entry.sha;
    }
    return null;
  }

  reachableCommits(tip: string): ParsedCommit[] {
    const seen = new Set<string>();
    const out: ParsedCommit[] = [];
    const stack: string[] = [tip];
    while (stack.length > 0) {
      const sha = stack.pop() as string;
      const key = lower(sha);
      if (seen.has(key)) continue;
      seen.add(key);
      const commit = this.getCommit(key);
      if (commit === null) continue;
      out.push(commit);
      for (const parent of commit.parents) stack.push(parent);
    }
    out.sort((a, b) => (b.epochSec - a.epochSec) || a.sha.localeCompare(b.sha));
    return out;
  }

  mergeBase(left: string, right: string): string | null {
    const leftKey = lower(left);
    const rightKey = lower(right);
    if (leftKey === rightKey) return leftKey;
    const leftDepth = new Map<string, number>();
    const leftQueue: Array<[string, number]> = [[leftKey, 0]];
    while (leftQueue.length > 0) {
      const [sha, depth] = leftQueue.shift() as [string, number];
      if (leftDepth.has(sha)) continue;
      leftDepth.set(sha, depth);
      const commit = this.getCommit(sha);
      if (commit === null) continue;
      for (const parent of commit.parents) leftQueue.push([lower(parent), depth + 1]);
    }
    const seen = new Set<string>();
    const rightQueue: Array<[string, number]> = [[rightKey, 0]];
    while (rightQueue.length > 0) {
      const [sha, depth] = rightQueue.shift() as [string, number];
      if (seen.has(sha)) continue;
      seen.add(sha);
      if (leftDepth.has(sha)) return sha;
      const commit = this.getCommit(sha);
      if (commit === null) continue;
      for (const parent of commit.parents) rightQueue.push([lower(parent), depth + 1]);
    }
    return null;
  }

}

export const store = new Store();

export function currentUser(): User {
  return store.viewer;
}

export function expectedToken(): string {
  return process.env.MAKEFUN_SHOP_TOKEN ?? '';
}

export function loginForToken(token: string | null | undefined): string | null {
  const expected = expectedToken();
  if (expected === '' || token === null || token === undefined || token !== expected) return null;
  return store.viewer.login;
}

export function isoFromEpoch(epochSec: number): string {
  return isoOf(epochSec);
}
