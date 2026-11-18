// Git smart HTTP: info/refs advertisements (upload-pack v2/v0, receive-pack v0), upload-pack
// (ls-refs and fetch) and receive-pack (push with report-status). Refs and objects live in the same
// store the REST surface uses, so a REST commit is fetchable and a push is visible to REST.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ZERO_OID,
  decodePktLines,
  encodePktLine,
  encodePktLines,
  hashObject,
  objectHeader,
  pktFlush,
  readPack,
  writePack,
  type GitObjectType,
  type PackObject,
} from './pack.ts';
import { store, type GitObjectType as StoreObjectType, type Repo } from './store.ts';
import { sendError } from './http.ts';

const AGENT = 'github-core-clone-01/1.0';
const HEX40 = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------------------------
// path and HTTP plumbing
// ---------------------------------------------------------------------------------------------

export interface GitRoute {
  readonly owner: string;
  readonly repo: string;
  readonly action: 'info/refs' | 'git-upload-pack' | 'git-receive-pack';
  readonly url: URL;
}

/** Parse `/<owner>/<repo>.git/<action>`; null when the path is not a git smart-HTTP route. */
export function parseGitRoute(rawUrl: string): GitRoute | null {
  let url: URL;
  try {
    url = new URL(rawUrl, 'http://entry');
  } catch {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
  if (!match) return null;
  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(match[1] as string);
    repo = decodeURIComponent(match[2] as string);
  } catch {
    return null;
  }
  return { owner, repo, action: match[3] as GitRoute['action'], url };
}

function sendAdvertisement(res: ServerResponse, service: string, body: Buffer): void {
  res.writeHead(200, {
    'content-type': `application/x-${service}-advertisement`,
    'cache-control': 'no-cache, max-age=0, must-revalidate',
    'content-length': body.length,
    expires: 'Fri, 01 Jan 1980 00:00:00 GMT',
    pragma: 'no-cache',
  });
  res.end(body);
}

function sendResult(res: ServerResponse, service: string, body: Buffer): void {
  res.writeHead(200, {
    'content-type': `application/x-${service}-result`,
    'cache-control': 'no-cache, max-age=0, must-revalidate',
    'content-length': body.length,
  });
  res.end(body);
}

async function readBody(req: IncomingMessage, maxBytes = 512 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------------------------
// object store bridge
// ---------------------------------------------------------------------------------------------

/** Write an object into the REST store, tag objects included. Returns its object id. */
function putObject(type: GitObjectType, data: Uint8Array): string {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const oid = hashObject(type, body);
  if (!store.objects.has(oid)) {
    const raw = Buffer.concat([objectHeader(type, body.length), body]);
    store.objects.set(oid, { type: type as unknown as StoreObjectType, content: body, raw });
  }
  return oid;
}

function objectOf(oid: string): PackObject | undefined {
  const object = store.readObject(oid);
  if (object === undefined) return undefined;
  return { type: object.type as GitObjectType, data: object.content };
}

function refObject(repo: Repo, ref: string): PackObject | undefined {
  const oid = repo.refs.get(ref);
  return oid === undefined ? undefined : objectOf(oid);
}

/** Follow annotated tags to the object they finally name. */
function peelOid(oid: string): string {
  let current = oid;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const object = store.readObject(current);
    if (object === undefined || object.type !== 'tag') return current;
    const match = /^object ([0-9a-f]{40})/m.exec(object.content.toString('utf8'));
    if (match === null) return current;
    current = match[1] as string;
  }
  return current;
}

// ---------------------------------------------------------------------------------------------
// ref advertisement
// ---------------------------------------------------------------------------------------------

interface AdvertisedRef {
  readonly name: string;
  readonly oid: string;
  readonly symrefTarget?: string;
}

function defaultBranchRef(repo: Repo): string {
  return `refs/heads/${repo.default_branch}`;
}

function headOid(repo: Repo): string | undefined {
  return repo.refs.get(defaultBranchRef(repo)) ?? repo.refs.get('refs/heads/main') ?? [...repo.refs.entries()].find(([ref]) => ref.startsWith('refs/heads/'))?.[1];
}

function advertisedRefs(repo: Repo, includeHead: boolean): AdvertisedRef[] {
  const refs: AdvertisedRef[] = [];
  const head = headOid(repo);
  if (includeHead) {
    refs.push({ name: 'HEAD', oid: head ?? ZERO_OID, symrefTarget: defaultBranchRef(repo) });
  }
  for (const [name, oid] of [...repo.refs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!HEX40.test(oid)) continue;
    refs.push({ name, oid });
  }
  return refs;
}

const UPLOAD_V0_CAPS = `side-band-64k ofs-delta shallow thin-pack no-progress include-tag agent=${AGENT} symref=HEAD:refs/heads/main object-format=sha1`;
const RECEIVE_V0_CAPS = `report-status report-status-v2 delete-refs side-band-64k ofs-delta agent=${AGENT} object-format=sha1`;

function v0Advertisement(repo: Repo, service: 'git-upload-pack' | 'git-receive-pack'): Buffer {
  const refs = advertisedRefs(repo, true);
  const caps =
    service === 'git-upload-pack'
      ? UPLOAD_V0_CAPS.replace('symref=HEAD:refs/heads/main', `symref=HEAD:${defaultBranchRef(repo)}`)
      : RECEIVE_V0_CAPS;
  const real = refs.filter((ref) => ref.name !== 'HEAD' || ref.oid !== ZERO_OID);
  const first = refs[0];
  const lines: Array<string | 'flush'> = [];
  if (first === undefined || real.length === 0) {
    lines.push(`${ZERO_OID} capabilities^{}\u0000${caps}\n`);
  } else {
    lines.push(`${first.oid} ${first.name}\u0000${caps}\n`);
    for (const ref of refs.slice(1)) {
      lines.push(`${ref.oid} ${ref.name}\n`);
      if (service === 'git-upload-pack') {
        const object = objectOf(ref.oid);
        if (object?.type === 'tag') {
          const peeled = peelOid(ref.oid);
          if (peeled !== ref.oid) lines.push(`${peeled} ${ref.name}^{}\n`);
        }
      }
    }
  }
  lines.push('flush');
  return encodePktLines(lines);
}

const V2_CAPS = [
  `agent=${AGENT}`,
  'ls-refs=unborn',
  'fetch=shallow filter',
  'object-format=sha1',
];

function v2Advertisement(): Buffer {
  const lines: Array<string | 'flush'> = ['version 2\n'];
  for (const capability of V2_CAPS) lines.push(`${capability}\n`);
  lines.push('flush');
  return encodePktLines(lines);
}

function hasProtocolV2(req: IncomingMessage): boolean {
  const header = req.headers['git-protocol'];
  const value = Array.isArray(header) ? header.join(' ') : header ?? '';
  return /(?:^|[,\s])version=2(?:$|[,\s])/.test(value);
}

// ---------------------------------------------------------------------------------------------
// reachability and fetch selection
// ---------------------------------------------------------------------------------------------

function addTreeObjects(treeOid: string, into: Set<string>): void {
  const stack = [treeOid];
  const seen = new Set<string>();
  while (stack.length) {
    const oid = stack.pop() as string;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const object = store.readObject(oid);
    if (object === undefined) continue;
    into.add(oid);
    if (object.type !== 'tree') continue;
    for (const entry of store.readTreeEntries(oid)) {
      if (entry.mode === '160000') continue;
      stack.push(entry.sha);
    }
  }
}

function collectReachable(roots: Iterable<string>, stopParents: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const root of roots) if (HEX40.test(root)) stack.push(root);
  while (stack.length) {
    const oid = stack.pop() as string;
    if (seen.has(oid)) continue;
    const object = store.readObject(oid);
    if (object === undefined) continue;
    seen.add(oid);
    if (object.type === 'commit') {
      const commit = store.getCommit(oid);
      if (commit === null) continue;
      stack.push(commit.tree);
      if (!stopParents.has(oid)) for (const parent of commit.parents) stack.push(parent);
    } else if (object.type === 'tag') {
      const match = /^object ([0-9a-f]{40})/m.exec(object.content.toString('utf8'));
      if (match !== null) stack.push(match[1] as string);
    } else if (object.type === 'tree') {
      for (const entry of store.readTreeEntries(oid)) {
        if (entry.mode === '160000') continue;
        stack.push(entry.sha);
      }
    }
  }
  return seen;
}

interface FetchSelection {
  readonly selected: Set<string>;
  readonly shallow: string[];
  readonly unshallow: string[];
}

function selectForFetch(
  wants: readonly string[],
  haves: readonly string[],
  depth: number | null,
  clientShallow: readonly string[],
  filter: string,
): FetchSelection {
  const wanted = new Set<string>();
  const shallow = new Set<string>();
  const unshallow = new Set<string>();
  const clientShallowSet = new Set(clientShallow);

  if (depth !== null) {
    const included = new Set<string>();
    const dist = new Map<string, number>();
    const roots: string[] = [];
    for (const want of wants) {
      const peeled = peelOid(want);
      if (store.getCommit(peeled) !== null && !roots.includes(peeled)) roots.push(peeled);
      const object = store.readObject(want);
      if (object?.type === 'tag') {
        // Keep the tag object itself (and any nested tags) in the pack.
        let current: string | undefined = want;
        const seenTags = new Set<string>();
        while (current !== undefined && !seenTags.has(current)) {
          seenTags.add(current);
          wanted.add(current);
          const tag = store.readObject(current);
          if (tag?.type !== 'tag') break;
          const match = /^object ([0-9a-f]{40})/m.exec(tag.content.toString('utf8'));
          current = match?.[1];
        }
      }
    }

    let frontier: Array<[string, number]> = roots.map((root) => [root, 0]);
    while (frontier.length) {
      const next: Array<[string, number]> = [];
      for (const [oid, distance] of frontier) {
        if (dist.has(oid)) continue;
        dist.set(oid, distance);
        included.add(oid);
        const commit = store.getCommit(oid);
        if (commit === null) continue;
        if (distance + 1 < depth) {
          for (const parent of commit.parents) {
            if (store.getCommit(parent) !== null) next.push([parent, distance + 1]);
          }
        } else if (commit.parents.some((parent) => store.getCommit(parent) !== null)) {
          shallow.add(oid);
        }
      }
      frontier = next;
    }

    for (const oid of included) {
      wanted.add(oid);
      const commit = store.getCommit(oid);
      if (commit !== null) addTreeObjects(commit.tree, wanted);
    }
    for (const boundary of clientShallowSet) {
      if (included.has(boundary) && !shallow.has(boundary)) unshallow.add(boundary);
    }
  } else {
    for (const oid of collectReachable(wants)) wanted.add(oid);
  }

  const haveSet = collectReachable(haves, clientShallowSet);
  const selected = new Set<string>();
  const blobless = /(?:^|[\s,])blob:none(?:$|[\s,])/.test(filter);
  for (const oid of wanted) {
    if (haveSet.has(oid)) continue;
    if (blobless) {
      const object = store.readObject(oid);
      if (object?.type === 'blob') continue;
    }
    selected.add(oid);
  }
  return { selected, shallow: [...shallow].sort(), unshallow: [...unshallow].sort() };
}

// ---------------------------------------------------------------------------------------------
// pack cache
// ---------------------------------------------------------------------------------------------

const PACK_CACHE_LIMIT = 64;
const packCache = new Map<string, Buffer>();

function buildPack(selection: FetchSelection): Buffer {
  const objects: PackObject[] = [];
  for (const oid of selection.selected) {
    const object = objectOf(oid);
    if (object !== undefined) objects.push(object);
  }
  objects.sort((a, b) => {
    const order = (type: GitObjectType): number => (type === 'commit' ? 0 : type === 'tree' ? 1 : type === 'blob' ? 2 : 3);
    const delta = order(a.type) - order(b.type);
    if (delta !== 0) return delta;
    return hashObject(a.type, a.data).localeCompare(hashObject(b.type, b.data));
  });
  return writePack(objects);
}

function cachedPack(repo: Repo, key: string, make: () => Buffer): Buffer {
  const cacheKey = `${store.repoKey(repo.owner, repo.name)}|${key}`;
  const found = packCache.get(cacheKey);
  if (found !== undefined) return found;
  const pack = make();
  if (packCache.size >= PACK_CACHE_LIMIT) {
    const oldest = packCache.keys().next().value as string | undefined;
    if (oldest !== undefined) packCache.delete(oldest);
  }
  packCache.set(cacheKey, pack);
  return pack;
}

function selectionKey(wants: readonly string[], haves: readonly string[], depth: number | null, shallow: readonly string[], filter: string): string {
  return `${[...wants].sort().join(',')}|${[...haves].sort().join(',')}|${depth ?? ''}|${[...shallow].sort().join(',')}|${filter}`;
}

// ---------------------------------------------------------------------------------------------
// pkt-line request parsing
// ---------------------------------------------------------------------------------------------

function splitRequest(body: Buffer): { lines: string[]; pack: Buffer } {
  const lines: string[] = [];
  let offset = 0;
  while (offset < body.length) {
    if (offset + 4 > body.length) throw new Error('truncated pkt-line header');
    const header = body.subarray(offset, offset + 4).toString('ascii');
    if (!/^[0-9a-fA-F]{4}$/.test(header)) throw new Error(`invalid pkt-line header ${JSON.stringify(header)}`);
    const length = Number.parseInt(header, 16);
    if (length === 0) {
      offset += 4;
      break;
    }
    if (length === 1 || length === 2) {
      offset += 4;
      continue;
    }
    if (length === 3 || length > 65520) throw new Error(`invalid pkt-line length ${length}`);
    if (offset + length > body.length) throw new Error('truncated pkt-line');
    lines.push(body.subarray(offset + 4, offset + length).toString('utf8').replace(/\r?\n$/, ''));
    offset += length;
  }
  return { lines, pack: body.subarray(offset) };
}

interface V2Request {
  readonly command: string;
  readonly capabilities: string[];
  readonly args: string[];
}

function parseV2Request(body: Buffer): V2Request {
  const packets = decodePktLines(body);
  const capabilities: string[] = [];
  const args: string[] = [];
  let command = '';
  let afterDelim = false;
  for (const packet of packets) {
    if (packet.kind === 'flush') break;
    if (packet.kind === 'delim') {
      afterDelim = true;
      continue;
    }
    if (packet.kind !== 'data') continue;
    const line = packet.payload.toString('utf8').replace(/\r?\n$/, '');
    if (!afterDelim) {
      if (line.startsWith('command=')) command = line.slice('command='.length);
      else if (line) capabilities.push(line);
    } else if (line) {
      args.push(line);
    }
  }
  return { command, capabilities, args };
}

// ---------------------------------------------------------------------------------------------
// ls-refs
// ---------------------------------------------------------------------------------------------

function handleLsRefs(repo: Repo, args: readonly string[]): Buffer {
  const prefixes = args.filter((line) => line.startsWith('ref-prefix ')).map((line) => line.slice('ref-prefix '.length));
  const peel = args.includes('peel');
  const symrefs = args.includes('symrefs');
  const unborn = args.includes('unborn');
  const keep = (name: string): boolean => prefixes.length === 0 || prefixes.some((prefix) => name.startsWith(prefix));
  const lines: Array<string | 'flush'> = [];

  const head = headOid(repo);
  const headTarget = defaultBranchRef(repo);
  if (keep('HEAD')) {
    if (head === undefined) {
      if (unborn && symrefs) lines.push(`unborn HEAD symref-target:${headTarget}\n`);
    } else {
      let line = `${head} HEAD`;
      if (symrefs) line += ` symref-target:${headTarget}`;
      lines.push(`${line}\n`);
    }
  }

  for (const [name, oid] of [...repo.refs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!HEX40.test(oid) || !keep(name)) continue;
    let line = `${oid} ${name}`;
    if (peel) {
      const object = objectOf(oid);
      if (object?.type === 'tag') {
        const target = peelOid(oid);
        if (target !== oid) line += ` peeled:${target}`;
      }
    }
    lines.push(`${line}\n`);
  }
  lines.push('flush');
  return encodePktLines(lines);
}

// ---------------------------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------------------------

interface FetchArgs {
  readonly wants: string[];
  readonly haves: string[];
  readonly shallow: string[];
  readonly depth: number | null;
  readonly filter: string;
  readonly done: boolean;
}

function parseFetchArgs(args: readonly string[]): FetchArgs {
  const wants: string[] = [];
  const haves: string[] = [];
  const shallow: string[] = [];
  let depth: number | null = null;
  let filter = '';
  let done = false;
  for (const line of args) {
    if (line.startsWith('want ')) {
      const oid = line.slice(5).split(' ')[0] as string;
      if (HEX40.test(oid)) wants.push(oid);
    } else if (line.startsWith('have ')) {
      const oid = line.slice(5).split(' ')[0] as string;
      if (HEX40.test(oid)) haves.push(oid);
    } else if (line.startsWith('shallow ')) {
      const oid = line.slice(8).trim();
      if (HEX40.test(oid)) shallow.push(oid);
    } else if (line.startsWith('deepen ')) {
      const value = Number.parseInt(line.slice(7).trim(), 10);
      if (Number.isFinite(value) && value > 0) depth = value;
    } else if (line.startsWith('filter ')) {
      filter = line.slice(7).trim();
    } else if (line === 'done') {
      done = true;
    }
  }
  return { wants: [...new Set(wants)], haves: [...new Set(haves)], shallow: [...new Set(shallow)], depth, filter, done };
}

function sidebandPackets(pack: Buffer): Array<string | Uint8Array> {
  const packets: Array<string | Uint8Array> = [];
  const MAX = 65_000;
  for (let offset = 0; offset < pack.length; offset += MAX) {
    const chunk = pack.subarray(offset, Math.min(offset + MAX, pack.length));
    const payload = Buffer.allocUnsafe(chunk.length + 1);
    payload[0] = 1;
    chunk.copy(payload, 1);
    packets.push(payload);
  }
  if (pack.length === 0) {
    packets.push(Buffer.from([1]));
  }
  return packets;
}

function fetchV2(repo: Repo, args: readonly string[]): Buffer {
  const request = parseFetchArgs(args);
  if (!request.wants.length) return pktFlush();
  const selection = selectForFetch(request.wants, request.haves, request.depth, request.shallow, request.filter);
  const key = selectionKey(request.wants, request.haves, request.depth, request.shallow, request.filter);
  const pack = cachedPack(repo, key, () => buildPack(selection));
  const packets: Array<string | Uint8Array | 'flush'> = [];
  if (selection.shallow.length || selection.unshallow.length) {
    packets.push('shallow-info\n');
    for (const oid of selection.shallow) packets.push(`shallow ${oid}\n`);
    for (const oid of selection.unshallow) packets.push(`unshallow ${oid}\n`);
    packets.push('flush');
  }
  packets.push('packfile\n');
  packets.push(...sidebandPackets(pack));
  packets.push('flush');
  return encodePktLines(packets);
}

function fetchV0(repo: Repo, args: readonly string[]): Buffer {
  const request = parseFetchArgs(args);
  if (!request.wants.length) return pktFlush();
  const selection = selectForFetch(request.wants, request.haves, request.depth, request.shallow, request.filter);
  const key = selectionKey(request.wants, request.haves, request.depth, request.shallow, request.filter);
  const pack = cachedPack(repo, key, () => buildPack(selection));
  const packets: Array<string | Uint8Array | 'flush'> = [];
  for (const oid of selection.shallow) packets.push(`shallow ${oid}\n`);
  for (const oid of selection.unshallow) packets.push(`unshallow ${oid}\n`);
  if (request.haves.length) packets.push(`ACK ${request.haves[request.haves.length - 1]}\n`);
  else packets.push('NAK\n');
  packets.push(...sidebandPackets(pack));
  packets.push('flush');
  return encodePktLines(packets);
}

// ---------------------------------------------------------------------------------------------
// receive-pack
// ---------------------------------------------------------------------------------------------

interface PushCommand {
  readonly oldOid: string;
  readonly newOid: string;
  readonly ref: string;
}

function isAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const seen = new Set<string>();
  const stack = [descendant];
  while (stack.length) {
    const oid = stack.pop() as string;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const commit = store.getCommit(oid);
    if (commit === null) continue;
    for (const parent of commit.parents) {
      if (parent === ancestor) return true;
      stack.push(parent);
    }
  }
  return false;
}

function updatePulls(repo: Repo, ref: string, oid: string | null): void {
  if (!ref.startsWith('refs/heads/')) return;
  const branch = ref.slice('refs/heads/'.length);
  for (const pull of repo.pulls.values()) {
    if (pull.head.ref === branch && oid !== null) pull.head.sha = oid;
    if (pull.base.ref === branch && oid !== null) pull.base.sha = oid;
  }
}

function parsePushCommands(lines: readonly string[]): Array<{ command: PushCommand; caps: string[] }> {
  const out: Array<{ command: PushCommand; caps: string[] }> = [];
  for (const raw of lines) {
    if (!raw) continue;
    const nul = raw.indexOf('\u0000');
    const main = nul >= 0 ? raw.slice(0, nul) : raw;
    const caps = nul >= 0 ? raw.slice(nul + 1).split(' ').filter(Boolean) : [];
    const parts = main.split(' ');
    if (parts.length < 3) throw new Error(`bad receive-pack command ${JSON.stringify(main.slice(0, 80))}`);
    const oldOid = (parts[0] as string).toLowerCase();
    const newOid = (parts[1] as string).toLowerCase();
    const ref = parts.slice(2).join(' ');
    if (!HEX40.test(oldOid) || !HEX40.test(newOid) || !ref.startsWith('refs/')) {
      throw new Error(`bad receive-pack command ${JSON.stringify(main.slice(0, 80))}`);
    }
    out.push({ command: { oldOid, newOid, ref }, caps });
  }
  return out;
}

function receivePack(repo: Repo, body: Buffer): Buffer {
  const split = splitRequest(body);
  const requested = parsePushCommands(split.lines);
  const caps = new Set(requested.flatMap((entry) => entry.caps));
  const sideband = caps.has('side-band-64k');
  const reportStatus = caps.has('report-status') || caps.has('report-status-v2');

  const report: string[] = [];
  let unpackOk = true;
  let unpackDetail = 'ok';

  if (split.pack.length > 0) {
    try {
      if (split.pack.subarray(0, 4).toString('ascii') !== 'PACK') throw new Error('pack does not start with PACK');
      const parsed = readPack(split.pack, { resolveBase: objectOf });
      if (!parsed.checksumOk) throw new Error('pack checksum mismatch');
      for (const [oid, object] of parsed.objects) {
        if (!store.objects.has(oid)) {
          const raw = Buffer.concat([objectHeader(object.type, object.data.length), object.data]);
          store.objects.set(oid, { type: object.type as unknown as StoreObjectType, content: object.data, raw });
        }
      }
    } catch (err) {
      unpackOk = false;
      unpackDetail = err instanceof Error ? err.message : 'unpack failed';
    }
  }

  const refResults: Array<{ ref: string; ok: boolean; reason: string }> = [];
  for (const { command } of requested) {
    const { oldOid, newOid, ref } = command;
    const current = repo.refs.get(ref) ?? ZERO_OID;
    if (!unpackOk) {
      refResults.push({ ref, ok: false, reason: 'unpacker error' });
      continue;
    }
    if (newOid === ZERO_OID) {
      if (current !== ZERO_OID && oldOid !== ZERO_OID && oldOid !== current) {
        refResults.push({ ref, ok: false, reason: 'stale info' });
        continue;
      }
      repo.refs.delete(ref);
      updatePulls(repo, ref, null);
      refResults.push({ ref, ok: true, reason: '' });
      continue;
    }
    if (store.readObject(newOid) === undefined) {
      refResults.push({ ref, ok: false, reason: 'missing necessary objects' });
      continue;
    }
    if (ref.startsWith('refs/heads/') && current !== ZERO_OID && current !== newOid) {
      if (!isAncestor(current, newOid)) {
        refResults.push({ ref, ok: false, reason: 'non-fast-forward' });
        continue;
      }
    }
    repo.refs.set(ref, newOid);
    updatePulls(repo, ref, newOid);
    refResults.push({ ref, ok: true, reason: '' });
  }

  // A pushed ref changes the graph a cached pack would be built from: drop this repo's cached packs.
  const prefix = `${store.repoKey(repo.owner, repo.name)}|`;
  for (const key of [...packCache.keys()]) if (key.startsWith(prefix)) packCache.delete(key);

  if (!reportStatus) return pktFlush();
  report.push(`unpack ${unpackDetail}`);
  for (const result of refResults) {
    report.push(result.ok ? `ok ${result.ref}` : `ng ${result.ref} ${result.reason}`);
  }
  const inner = encodePktLines([...report.map((line) => `${line}\n`), 'flush']);
  if (!sideband) return inner;

  const packets: Array<string | Uint8Array | 'flush'> = [];
  const MAX = 65_000;
  for (let offset = 0; offset < inner.length; offset += MAX) {
    const chunk = inner.subarray(offset, Math.min(offset + MAX, inner.length));
    const payload = Buffer.allocUnsafe(chunk.length + 1);
    payload[0] = 1;
    chunk.copy(payload, 1);
    packets.push(payload);
  }
  packets.push('flush');
  return encodePktLines(packets);
}

// ---------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------

/** Handle one parsed git route; the caller has already checked the repository's existence. */
export async function handleGit(req: IncomingMessage, res: ServerResponse, route: GitRoute): Promise<void> {
  const repo = store.getRepo(route.owner, route.repo);
  if (repo === undefined) {
    sendError(res, 404, 'Not Found');
    return;
  }
  const method = req.method ?? 'GET';

  if (route.action === 'info/refs') {
    if (method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed');
      return;
    }
    const service = route.url.searchParams.get('service');
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
      sendError(res, 403, 'Service not enabled');
      return;
    }
    if (service === 'git-upload-pack' && hasProtocolV2(req)) {
      sendAdvertisement(res, service, v2Advertisement());
      return;
    }
    const preamble = encodePktLines([`# service=${service}\n`, 'flush']);
    sendAdvertisement(res, service, Buffer.concat([preamble, v0Advertisement(repo, service)]));
    return;
  }

  if (method !== 'POST') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const body = await readBody(req);
  if (route.action === 'git-upload-pack') {
    const request = parseV2Request(body);
    if (request.command === 'ls-refs') {
      sendResult(res, 'git-upload-pack', handleLsRefs(repo, request.args));
      return;
    }
    if (request.command === 'fetch') {
      sendResult(res, 'git-upload-pack', fetchV2(repo, request.args));
      return;
    }
    // No v2 command: a v0 want/have request. v0 has no delimiters, and both of its sections end
    // in flushes, so read every data line in the body.
    const v0Lines = decodePktLines(body)
      .filter((packet) => packet.kind === 'data')
      .map((packet) => (packet.kind === 'data' ? packet.payload.toString('utf8').replace(/\r?\n$/, '') : ''));
    sendResult(res, 'git-upload-pack', fetchV0(repo, v0Lines));
    return;
  }

  sendResult(res, 'git-receive-pack', receivePack(repo, body));
}
