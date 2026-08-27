#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const liveNpmPackuments = new Map();
const liveNpmArtifacts = new Map();

export function validateCandidateAssessments(document, streamIds) {
  if (document?.schemaVersion !== 1 || document.streams === null || typeof document.streams !== 'object' || Array.isArray(document.streams)) {
    throw new Error('candidate assessments must be a schema-v1 stream map');
  }
  const allowed = streamIds === undefined ? null : new Set(streamIds);
  for (const [streamId, entries] of Object.entries(document.streams)) {
    if (allowed !== null && !allowed.has(streamId)) throw new Error(`candidate assessments contain unknown stream ${streamId}`);
    if (!Array.isArray(entries)) throw new Error(`${streamId}: candidate assessments must be an array`);
    const versions = new Set();
    for (const entry of entries) {
      if (
        entry?.state !== 'red' ||
        parseVersion(entry.version) === null ||
        typeof entry.candidateDigest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(entry.candidateDigest) ||
        !Number.isSafeInteger(entry.certificationRevision) ||
        entry.certificationRevision < 1 ||
        entry.source === null ||
        typeof entry.source !== 'object' ||
        Array.isArray(entry.source)
      )
        throw new Error(`${streamId}: malformed candidate assessment`);
      if (versions.has(entry.version)) throw new Error(`${streamId}: duplicate candidate assessment for ${entry.version}`);
      versions.add(entry.version);
    }
  }
  return document;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function matchesCatalogSource(catalogSource, storedSource) {
  if (catalogSource === null || typeof catalogSource !== 'object' || storedSource === null || typeof storedSource !== 'object') {
    return Object.is(catalogSource, storedSource);
  }
  if (Array.isArray(catalogSource)) {
    return Array.isArray(storedSource) && catalogSource.length === storedSource.length && catalogSource.every((value, index) => matchesCatalogSource(value, storedSource[index]));
  }
  return !Array.isArray(storedSource) && Object.entries(catalogSource).every(([key, value]) => matchesCatalogSource(value, storedSource[key]));
}

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return left.localeCompare(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function validateSource(entry, stream) {
  if (stream.registry === 'go') {
    if (typeof entry.source?.sum !== 'string' || !entry.source.sum.startsWith('h1:')) throw new Error(`${stream.id}@${entry.version}: missing Go module sum`);
    if (typeof entry.source?.goModSum !== 'string' || !entry.source.goModSum.startsWith('h1:')) throw new Error(`${stream.id}@${entry.version}: missing Go module go.mod sum`);
    if (typeof entry.source?.zipSha256 !== 'string' || !SHA256.test(entry.source.zipSha256)) throw new Error(`${stream.id}@${entry.version}: missing zip sha256`);
    const unsupported = entry.source?.toolchainSupported === false;
    const required = typeof entry.source?.requiredGoVersion === 'string' && /^\d+(?:\.\d+){1,2}$/u.test(entry.source.requiredGoVersion);
    if (unsupported !== required) throw new Error(`${stream.id}@${entry.version}: incomplete unsupported Go toolchain evidence`);
  } else if (stream.registry === 'npm') {
    if (typeof entry.source?.integrity !== 'string' || !entry.source.integrity.startsWith('sha512-')) throw new Error(`${stream.id}@${entry.version}: missing npm integrity`);
    if (typeof entry.source?.shasum !== 'string' || !SHA1.test(entry.source.shasum)) throw new Error(`${stream.id}@${entry.version}: missing npm shasum`);
    if (typeof entry.source?.tarballSha256 !== 'string' || !SHA256.test(entry.source.tarballSha256)) throw new Error(`${stream.id}@${entry.version}: missing npm tarball sha256`);
    if (stream.monitorDependencyClosure === true) {
      if (entry.source?.closureComplete !== true || !Array.isArray(entry.source?.dependencyRoots) || !Array.isArray(entry.source?.dependencyClosure))
        throw new Error(`${stream.id}@${entry.version}: npm dependency closure is incomplete`);
      if (typeof entry.source?.closureDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(entry.source.closureDigest))
        throw new Error(`${stream.id}@${entry.version}: npm dependency closure has no digest`);
      if (
        entry.source.closureDigest !==
        digest({
          dependencyRoots: entry.source.dependencyRoots,
          dependencyClosure: entry.source.dependencyClosure,
        })
      )
        throw new Error(`${stream.id}@${entry.version}: npm dependency closure digest does not match the graph`);
    }
    for (const dependency of entry.source?.dependencyClosure ?? []) {
      if (
        typeof dependency.name !== 'string' ||
        parseVersion(dependency.version) === null ||
        typeof dependency.integrity !== 'string' ||
        !dependency.integrity.startsWith('sha512-') ||
        typeof dependency.tarball !== 'string' ||
        typeof dependency.tarballSha256 !== 'string' ||
        !SHA256.test(dependency.tarballSha256)
      )
        throw new Error(`${stream.id}@${entry.version}: dependency closure is not fully checksum-bound`);
    }
    if (stream.monitorDependencyClosure === true) {
      const nodes = new Set();
      for (const dependency of entry.source.dependencyClosure) {
        const key = `${dependency.name}@${dependency.version}`;
        if (nodes.has(key)) throw new Error(`${stream.id}@${entry.version}: duplicate npm closure node ${key}`);
        nodes.add(key);
        if (!Array.isArray(dependency.dependencies)) throw new Error(`${stream.id}@${entry.version}: npm closure node ${key} has no exact edges`);
      }
      for (const edge of [...entry.source.dependencyRoots, ...entry.source.dependencyClosure.flatMap((dependency) => dependency.dependencies)]) {
        if (
          typeof edge.name !== 'string' ||
          typeof edge.requested !== 'string' ||
          !['dependency', 'optional', 'peer'].includes(edge.type) ||
          typeof edge.packageName !== 'string' ||
          parseVersion(edge.version) === null ||
          !nodes.has(`${edge.packageName}@${edge.version}`)
        )
          throw new Error(`${stream.id}@${entry.version}: npm closure contains an unresolved edge`);
      }
    }
  } else if (stream.registry === 'pypi') {
    if (typeof entry.source?.sha256 !== 'string' || !SHA256.test(entry.source.sha256)) throw new Error(`${stream.id}@${entry.version}: missing PyPI file sha256`);
    if (!Array.isArray(entry.source?.files) || entry.source.files.length === 0 || entry.source.files.some((file) => typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)))
      throw new Error(`${stream.id}@${entry.version}: incomplete PyPI file hashes`);
  } else if (typeof entry.source?.checksum !== 'string' || !SHA256.test(entry.source.checksum)) {
    throw new Error(`${stream.id}@${entry.version}: missing crates.io checksum`);
  }
}

export async function selectCandidates({ rootDir = root, config, ledger, assessments = { schemaVersion: 1, streams: {} }, catalogs, maximum = config.maxCandidatesPerRun, sourceResolver, streamId }) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32) throw new Error('maximum must be between 1 and 32');
  validateCandidateAssessments(
    assessments,
    config.streams.map((stream) => stream.id),
  );
  if (streamId !== undefined && !config.streams.some((stream) => stream.id === streamId)) {
    throw new Error(`unknown candidate stream ${streamId}`);
  }
  const pending = [];
  const selectedStreams = config.streams.filter((stream) => streamId === undefined || stream.id === streamId);
  for (const stream of [...selectedStreams].sort((a, b) => a.id.localeCompare(b.id))) {
    const integrationMode = stream.mode ?? 'patch';
    if (!Number.isSafeInteger(stream.certificationRevision) || stream.certificationRevision < 1) {
      throw new Error(`${stream.id}: certificationRevision must be a positive integer`);
    }
    if (integrationMode === 'hook' && !['exact-source', 'runtime'].includes(stream.hookStrategy)) {
      throw new Error(`${stream.id}: hook mode requires an explicit exact-source or runtime strategy`);
    }
    if (integrationMode === 'capability' && (stream.capabilityStrategy !== 'compile-conformance' || typeof stream.capability !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(stream.capability))) {
      throw new Error(`${stream.id}: capability mode requires a normalized capability and compile-conformance strategy`);
    }
    if (!['patch', 'hook', 'capability'].includes(integrationMode)) {
      throw new Error(`${stream.id}: unsupported candidate integration mode ${String(integrationMode)}`);
    }
    const seen = new Map((ledger.streams?.[stream.id] ?? []).map((entry) => [entry.version, entry]));
    const assessed = new Map((assessments.streams[stream.id] ?? []).map((entry) => [entry.version, entry]));
    const minimum = parseVersion(stream.minimumVersion);
    if (minimum === null) throw new Error(`${stream.id}: invalid minimumVersion`);
    for (const entry of catalogs[stream.id] ?? []) {
      const parsed = parseVersion(entry.version);
      if (parsed === null || parsed.prerelease !== null || (stream.major !== undefined && parsed.major !== stream.major)) continue;
      if (compareVersions(entry.version, stream.minimumVersion) < 0 || entry.yanked === true) continue;
      let resolvedSource = entry.source;
      const recorded = seen.get(entry.version);
      const assessment = assessed.get(entry.version);
      let sourceResolved = false;
      if (recorded !== undefined) {
        if (stream.registry !== 'npm' || stream.monitorDependencyClosure !== true) continue;
        resolvedSource = sourceResolver === undefined ? entry.source : await sourceResolver(stream, entry.version, entry.source, recorded.source);
        validateSource({ version: entry.version, source: resolvedSource }, stream);
        if (digest(recorded.source) === digest(resolvedSource)) continue;
        sourceResolved = true;
      } else if (assessment !== undefined) {
        // Registry catalogs already carry a lightweight immutable release
        // identity. Reuse the checksum-bound assessment while that identity is
        // unchanged; resolving every historical red version here would make a
        // bounded certification batch perform unbounded downloads before the
        // scheduler even runs. A changed catalog identity remains pending and
        // is fully resolved only if the fair scheduler selects it.
        if (matchesCatalogSource(entry.source, assessment.source)) {
          resolvedSource = assessment.source;
          validateSource({ version: entry.version, source: resolvedSource }, stream);
          // An unchanged red assessment is filtered below without resolving.
          // If a revision or prepared patch requalifies a monitored npm root,
          // however, the scheduled candidate must resolve today's dependency
          // closure instead of certifying the stale stored graph.
          sourceResolved = !(stream.registry === 'npm' && stream.monitorDependencyClosure === true);
        }
      }
      if (!Number.isFinite(Date.parse(entry.publishedAt))) throw new Error(`${stream.id}@${entry.version}: invalid publishedAt`);
      const patchMode = integrationMode === 'patch';
      const manifestPath = patchMode ? join(rootDir, stream.patchRoot, entry.version, 'manifest.json') : null;
      const ready =
        patchMode &&
        (await access(manifestPath).then(
          () => true,
          () => false,
        ));
      const manifestDigest = ready
        ? `sha256:${createHash('sha256')
            .update(await readFile(manifestPath))
            .digest('hex')}`
        : null;
      const candidate = {
        id: `${stream.id}@${entry.version}`,
        streamId: stream.id,
        frameworkId: stream.frameworkId,
        ecosystem: stream.ecosystem,
        registry: stream.registry,
        package: stream.package,
        version: entry.version,
        certificationRevision: stream.certificationRevision,
        publishedAt: entry.publishedAt,
        source: resolvedSource,
        monitorDependencyClosure: stream.registry === 'npm' && stream.monitorDependencyClosure === true,
        mode: integrationMode,
        ...(integrationMode === 'hook' ? { hookStrategy: stream.hookStrategy } : {}),
        ...(integrationMode === 'capability'
          ? {
              capability: stream.capability,
              capabilityStrategy: stream.capabilityStrategy,
            }
          : {}),
        patch: patchMode
          ? {
              status: ready ? 'ready' : 'needs-patch',
              path: `${stream.patchRoot}/${entry.version}/manifest.json`,
              manifestDigest,
            }
          : { status: 'not-applicable', path: null, manifestDigest: null },
      };
      if (assessment !== undefined && assessment.candidateDigest === digest(candidate)) continue;
      pending.push({
        candidate,
        stream,
        sourceResolved,
        reuseSource: assessment?.source,
      });
    }
  }
  const comparePending = (a, b) =>
    Date.parse(a.candidate.publishedAt) - Date.parse(b.candidate.publishedAt) || a.candidate.streamId.localeCompare(b.candidate.streamId) || compareVersions(a.candidate.version, b.candidate.version);
  pending.sort(comparePending);
  // A permanently red stream must not consume the whole bounded batch forever.
  // Preserve oldest-first order inside each stream, but take one candidate from
  // every pending stream before taking a second candidate from any of them.
  const queues = new Map();
  for (const entry of pending) {
    const queue = queues.get(entry.candidate.streamId) ?? [];
    queue.push(entry);
    queues.set(entry.candidate.streamId, queue);
  }
  const scheduled = [];
  while (scheduled.length < maximum && scheduled.length < pending.length) {
    const round = [...queues.values()].filter((queue) => queue.length > 0).sort((a, b) => comparePending(a[0], b[0]));
    for (const queue of round) {
      const entry = queue.shift();
      if (entry !== undefined) scheduled.push(entry);
      if (scheduled.length === maximum) break;
    }
  }
  const selected = [];
  for (const { candidate, stream, sourceResolved, reuseSource } of scheduled) {
    const source = sourceResolver === undefined || sourceResolved ? candidate.source : await sourceResolver(stream, candidate.version, candidate.source, reuseSource);
    const withSource = { ...candidate, source };
    validateSource(withSource, stream);
    selected.push({ ...withSource, candidateDigest: digest(withSource) });
  }
  return {
    schemaVersion: 1,
    kind: 'termwright-framework-candidate-registry',
    limit: maximum,
    totalPending: pending.length,
    backlog: Math.max(0, pending.length - maximum),
    candidates: selected,
  };
}

async function goCatalog(stream) {
  const response = await fetch(`https://proxy.golang.org/${stream.package}/@v/list`);
  if (!response.ok && response.status === 404 && stream.allowMissingPackage === true) return [];
  if (!response.ok) throw new Error(`${stream.id}: Go proxy list failed with ${response.status}`);
  const versions = (await response.text()).trim().split(/\s+/u).filter(Boolean);
  const entries = [];
  for (const version of versions) {
    const parsed = parseVersion(version);
    if (parsed === null || parsed.prerelease !== null || (stream.major !== undefined && parsed.major !== stream.major) || compareVersions(version, stream.minimumVersion) < 0) continue;
    const infoResponse = await fetch(`https://proxy.golang.org/${stream.package}/@v/${version}.info`);
    if (!infoResponse.ok) throw new Error(`${stream.id}@${version}: Go proxy info failed with ${infoResponse.status}`);
    const info = await infoResponse.json();
    entries.push({
      version,
      publishedAt: info.Time,
      source: {
        proxy: 'https://proxy.golang.org',
        checksumDatabase: 'sum.golang.org',
      },
    });
  }
  return entries;
}

export function parseGoDownloadResult(moduleVersion, stdout) {
  const downloaded = JSON.parse(stdout);
  if (typeof downloaded.Error === 'string' && downloaded.Error.length > 0) {
    const unsupported = /requires go >= ([0-9]+(?:\.[0-9]+){1,2}) \(running go [^;]+; GOTOOLCHAIN=local\)$/u.exec(downloaded.Error);
    if (unsupported !== null && typeof downloaded.Sum === 'string' && typeof downloaded.GoModSum === 'string' && typeof downloaded.Zip === 'string') {
      return { ...downloaded, RequiredGoVersion: unsupported[1] };
    }
    throw new Error(`${moduleVersion}: ${downloaded.Error}`);
  }
  return downloaded;
}

export function recoverGoDownloadFailure(moduleVersion, error) {
  if (typeof error?.stdout !== 'string' || error.stdout.length === 0) throw error;
  const downloaded = parseGoDownloadResult(moduleVersion, error.stdout);
  if (downloaded.RequiredGoVersion === undefined) throw error;
  return downloaded;
}

export function trustedGoEnvironment(overrides = {}, baseEnvironment = process.env) {
  return { ...baseEnvironment, ...overrides, GOTOOLCHAIN: 'local' };
}

async function resolveSource(stream, version, source, recordedSource) {
  if (stream.registry === 'npm') return resolveNpmSource(stream, source, { reuseSource: recordedSource });
  if (stream.registry === 'pypi') return resolvePypiSource(stream, source);
  if (stream.registry !== 'go') return source;
  const moduleVersion = `${stream.package}@${version}`;
  let downloaded;
  try {
    const { stdout } = await exec('go', ['mod', 'download', '-json', moduleVersion], {
      cwd: root,
      env: trustedGoEnvironment({
        GOFLAGS: '',
        GONOSUMDB: '',
        GOPRIVATE: '',
        GOPROXY: 'https://proxy.golang.org',
        GOSUMDB: 'sum.golang.org',
        GOWORK: 'off',
      }),
    });
    downloaded = parseGoDownloadResult(moduleVersion, stdout);
  } catch (error) {
    downloaded = recoverGoDownloadFailure(moduleVersion, error);
  }
  const zip = await readFile(downloaded.Zip);
  return {
    ...source,
    sum: downloaded.Sum,
    goModSum: downloaded.GoModSum,
    zipSha256: createHash('sha256').update(zip).digest('hex'),
    ...(downloaded.RequiredGoVersion === undefined
      ? {}
      : {
          requiredGoVersion: downloaded.RequiredGoVersion,
          toolchainSupported: false,
        }),
  };
}

async function cratesCatalog(stream) {
  const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(stream.package)}/versions`, { headers: { 'user-agent': 'termwright-compatibility-workflow/1' } });
  if (!response.ok) throw new Error(`${stream.id}: crates.io failed with ${response.status}`);
  const body = await response.json();
  return (body.versions ?? []).map((item) => ({
    version: item.num,
    publishedAt: item.created_at,
    yanked: item.yanked,
    source: { checksum: item.checksum, registry: 'https://crates.io' },
  }));
}

function npmPackageUrl(name) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
}

export async function npmCatalog(stream, fetchImpl = fetch) {
  const response = await fetchImpl(npmPackageUrl(stream.package));
  if (!response.ok) throw new Error(`${stream.id}: npm registry failed with ${response.status}`);
  const body = await response.json();
  return Object.entries(body.versions ?? {}).map(([version, metadata]) => ({
    version,
    publishedAt: body.time?.[version],
    source: {
      registry: 'https://registry.npmjs.org',
      tarball: metadata.dist?.tarball,
      integrity: metadata.dist?.integrity,
      shasum: metadata.dist?.shasum,
      dependencies: metadata.dependencies ?? {},
      optionalDependencies: metadata.optionalDependencies ?? {},
      peerDependencies: metadata.peerDependencies ?? {},
      peerDependenciesMeta: metadata.peerDependenciesMeta ?? {},
      bundledDependencies: metadata.bundledDependencies ?? metadata.bundleDependencies ?? [],
      os: metadata.os ?? [],
      cpu: metadata.cpu ?? [],
      libc: metadata.libc ?? [],
    },
  }));
}

export async function pypiCatalog(stream, fetchImpl = fetch) {
  const response = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(stream.package)}/json`);
  if (!response.ok) throw new Error(`${stream.id}: PyPI failed with ${response.status}`);
  const body = await response.json();
  return Object.entries(body.releases ?? {}).flatMap(([version, releaseFiles]) => {
    const usable = [...releaseFiles]
      .filter((file) => file.yanked !== true && typeof file.url === 'string' && typeof file.digests?.sha256 === 'string')
      .sort((a, b) => Number(b.packagetype === 'sdist') - Number(a.packagetype === 'sdist') || a.filename.localeCompare(b.filename));
    if (usable.length === 0) return [];
    return [
      {
        version,
        publishedAt: usable
          .map((file) => file.upload_time_iso_8601)
          .filter(Boolean)
          .sort()[0],
        source: {
          registry: 'https://pypi.org',
          url: usable[0].url,
          filename: usable[0].filename,
          packagetype: usable[0].packagetype,
          sha256: usable[0].digests.sha256,
          files: usable.map((file) => ({
            filename: file.filename,
            packagetype: file.packagetype,
            sha256: file.digests.sha256,
            url: file.url,
          })),
        },
      },
    ];
  });
}

async function verifiedDownload(url, expected, algorithm, fetchImpl = fetch, cache = null) {
  const key = `${algorithm}:${expected}:${url}`;
  let promise = cache?.get(key);
  if (promise === undefined) {
    promise = (async () => {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`${url}: artifact download failed with ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    })();
    cache?.set(key, promise);
  }
  const bytes = await promise;
  const actual = createHash(algorithm)
    .update(bytes)
    .digest(algorithm === 'sha512' ? 'base64' : 'hex');
  if (actual !== expected) throw new Error(`${url}: ${algorithm} did not match registry metadata`);
  return bytes;
}

export async function downloadVerifiedNpmTarball(source, fetchImpl = fetch) {
  if (typeof source?.tarball !== 'string' || typeof source?.integrity !== 'string' || typeof source?.shasum !== 'string') throw new Error('npm release lacks dist evidence');
  const [algorithm, expectedIntegrity] = source.integrity.split('-', 2);
  if (algorithm !== 'sha512' || expectedIntegrity === undefined) throw new Error('npm release does not publish sha512 integrity');
  const bytes = await verifiedDownload(source.tarball, expectedIntegrity, 'sha512', fetchImpl, fetchImpl === fetch ? liveNpmArtifacts : null);
  if (createHash('sha1').update(bytes).digest('hex') !== source.shasum) throw new Error('npm shasum does not match tarball');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (source.tarballSha256 !== undefined && source.tarballSha256 !== sha256) throw new Error('npm tarball sha256 does not match discovered evidence');
  return bytes;
}

function npmVersion(value) {
  const parsed = parseVersion(value);
  return parsed === null ? null : { ...parsed, raw: value.replace(/^v/u, '') };
}

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const a = left.split('.');
  const b = right.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;
    const an = /^\d+$/u.test(a[index]) ? Number(a[index]) : null;
    const bn = /^\d+$/u.test(b[index]) ? Number(b[index]) : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return a[index].localeCompare(b[index]);
  }
  return 0;
}

function compareNpmVersions(left, right) {
  const a = npmVersion(left);
  const b = npmVersion(right);
  if (a === null || b === null) throw new Error(`invalid npm semantic version: ${a === null ? left : right}`);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePrerelease(a.prerelease, b.prerelease);
}

function comparator(operator, version) {
  return (candidate) => {
    const comparison = compareNpmVersions(candidate, version);
    if (operator === '>') return comparison > 0;
    if (operator === '>=') return comparison >= 0;
    if (operator === '<') return comparison < 0;
    if (operator === '<=') return comparison <= 0;
    return comparison === 0;
  };
}

function partialBounds(token) {
  const match = /^(?:v)?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/u.exec(token);
  if (match === null) return null;
  const parts = [match[1], match[2], match[3]];
  const wildcard = parts.findIndex((part) => part === undefined || /^[xX*]$/u.test(part));
  if (wildcard === 0) return { any: true, precision: 0 };
  const major = Number(parts[0]);
  const minor = wildcard === 1 ? 0 : Number(parts[1]);
  const patch = wildcard === 1 || wildcard === 2 ? 0 : Number(parts[2]);
  const lower = `${major}.${minor}.${patch}${match[4] === undefined ? '' : `-${match[4]}`}`;
  if (wildcard < 0) return { lower, exact: true, precision: 3 };
  const upper = wildcard === 1 ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  return { lower, upper, precision: wildcard };
}

function tokenPredicates(token) {
  if (token === '' || token === '*' || /^[xX]$/u.test(token)) return [];
  const operatorMatch = /^(<=|>=|<|>|=)?(.+)$/u.exec(token);
  const operator = operatorMatch[1] ?? '';
  const value = operatorMatch[2];
  if (value.startsWith('^') || value.startsWith('~')) {
    const kind = value[0];
    const bounds = partialBounds(value.slice(1));
    if (bounds === null || bounds.any === true) throw new Error(`unsupported npm range token ${token}`);
    const parsed = npmVersion(bounds.lower);
    let upper;
    if (kind === '~') upper = bounds.precision < 2 ? `${parsed.major + 1}.0.0` : `${parsed.major}.${parsed.minor + 1}.0`;
    else if (bounds.precision < 2 || parsed.major > 0) upper = `${parsed.major + 1}.0.0`;
    else if (parsed.minor > 0) upper = `0.${parsed.minor + 1}.0`;
    else upper = `0.0.${parsed.patch + 1}`;
    return [comparator('>=', bounds.lower), comparator('<', upper)];
  }
  const bounds = partialBounds(value);
  if (bounds === null) throw new Error(`unsupported npm dependency selector ${token}`);
  if (operator !== '') {
    if (bounds.any === true) return [];
    if (bounds.exact === true || ['>', '>='].includes(operator)) return [comparator(operator, bounds.lower)];
    if (operator === '<') return [comparator('<', bounds.lower)];
    if (operator === '<=') return [comparator('<', bounds.upper)];
    throw new Error(`unsupported wildcard comparator ${token}`);
  }
  if (bounds.any === true) return [];
  if (bounds.exact === true) return [comparator('', bounds.lower)];
  return [comparator('>=', bounds.lower), comparator('<', bounds.upper)];
}

function satisfiesNpmRange(version, range) {
  const parsed = npmVersion(version);
  if (parsed === null) return false;
  return range.split(/\s*\|\|\s*/u).some((alternative) => {
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/u.exec(alternative);
    const tokens = hyphen === null ? alternative.trim().split(/\s+/u).filter(Boolean) : [`>=${hyphen[1]}`, `<=${hyphen[2]}`];
    const predicates = tokens.flatMap(tokenPredicates);
    if (!predicates.every((predicate) => predicate(version))) return false;
    // npm excludes prereleases unless the range explicitly names one on the
    // same major/minor/patch tuple.
    if (parsed.prerelease !== null && !tokens.some((token) => token.includes('-') && token.includes(`${parsed.major}.${parsed.minor}.${parsed.patch}`))) return false;
    return true;
  });
}

function dependencyDeclarations(metadata) {
  const bundled = metadata.bundleDependencies ?? metadata.bundledDependencies;
  if (bundled === true || (Array.isArray(bundled) && bundled.length > 0)) throw new Error(`${metadata.name ?? 'npm package'}: bundled production dependencies cannot be independently checksum-bound`);
  const declarations = new Map();
  for (const [type, values] of [
    ['dependency', metadata.dependencies ?? {}],
    ['peer', metadata.peerDependencies ?? {}],
    ['optional', metadata.optionalDependencies ?? {}],
  ]) {
    for (const [name, requested] of Object.entries(values)) {
      // npm's optionalDependencies entries override same-name dependencies.
      if (type === 'dependency' && Object.hasOwn(metadata.optionalDependencies ?? {}, name)) continue;
      declarations.set(`${type}\0${name}`, {
        name,
        requested,
        type,
        optionalPeer: type === 'peer' && metadata.peerDependenciesMeta?.[name]?.optional === true,
      });
    }
  }
  return [...declarations.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || String(a.requested).localeCompare(String(b.requested)));
}

function parseNpmAlias(declaredName, requested) {
  if (typeof requested !== 'string' || requested.length === 0) throw new Error(`${declaredName}: dependency selector must be a non-empty string`);
  if (!requested.startsWith('npm:')) return { packageName: declaredName, range: requested };
  const match = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/u.exec(requested);
  if (match === null) throw new Error(`${declaredName}: unsupported npm alias ${requested}`);
  return { packageName: match[1], range: match[2] };
}

export async function resolveNpmDependencyClosure(
  source,
  { fetchImpl = fetch, packuments = fetchImpl === fetch ? liveNpmPackuments : new Map(), artifacts = fetchImpl === fetch ? liveNpmArtifacts : new Map(), reuseClosure = [] } = {},
) {
  const reusable = new Map((reuseClosure ?? []).map((node) => [`${node.name}@${node.version}`, node]));
  const nodes = new Map();
  const resolving = new Map();
  const getPackument = async (name) => {
    if (!packuments.has(name)) {
      packuments.set(
        name,
        (async () => {
          const response = await fetchImpl(npmPackageUrl(name));
          if (!response.ok) throw new Error(`npm dependency ${name}: registry metadata failed with ${response.status}`);
          return response.json();
        })(),
      );
    }
    return packuments.get(name);
  };
  const resolveDeclaration = async (declaration) => {
    const { packageName, range } = parseNpmAlias(declaration.name, declaration.requested);
    const packument = await getPackument(packageName);
    let version = packument['dist-tags']?.[range];
    if (version === undefined) {
      const matches = Object.keys(packument.versions ?? {})
        .filter((candidate) => satisfiesNpmRange(candidate, range))
        .sort(compareNpmVersions);
      version = matches.at(-1);
    }
    if (version === undefined || packument.versions?.[version] === undefined) throw new Error(`npm dependency ${declaration.name}@${range}: no exact registry version satisfies the selector`);
    const key = `${packageName}@${version}`;
    if (nodes.has(key)) return nodes.get(key);
    if (!resolving.has(key)) {
      resolving.set(
        key,
        (async () => {
          const metadata = packument.versions[version];
          if (metadata.name !== undefined && metadata.name !== packageName) throw new Error(`${key}: registry metadata returned another package name`);
          const integrity = metadata.dist?.integrity;
          const tarball = metadata.dist?.tarball;
          if (typeof integrity !== 'string' || !integrity.startsWith('sha512-') || typeof tarball !== 'string') throw new Error(`${key}: dependency lacks sha512 integrity or tarball URL`);
          const prior = reusable.get(key);
          const canReuse =
            prior?.integrity === integrity && prior?.tarball === tarball && prior?.shasum === metadata.dist?.shasum && typeof prior?.tarballSha256 === 'string' && SHA256.test(prior.tarballSha256);
          const bytes = canReuse ? null : await verifiedDownload(tarball, integrity.slice('sha512-'.length), 'sha512', fetchImpl, artifacts);
          if (bytes !== null && typeof metadata.dist?.shasum === 'string' && createHash('sha1').update(bytes).digest('hex') !== metadata.dist.shasum)
            throw new Error(`${key}: dependency shasum does not match tarball`);
          const node = {
            name: packageName,
            version,
            integrity,
            tarball,
            tarballSha256: canReuse ? prior.tarballSha256 : createHash('sha256').update(bytes).digest('hex'),
            ...(typeof metadata.dist?.shasum === 'string' ? { shasum: metadata.dist.shasum } : {}),
            platform: {
              os: [...(metadata.os ?? [])].sort(),
              cpu: [...(metadata.cpu ?? [])].sort(),
              libc: [...(metadata.libc ?? [])].sort(),
            },
            dependencies: [],
          };
          nodes.set(key, node);
          for (const child of dependencyDeclarations(metadata)) {
            const resolved = await resolveDeclaration(child);
            node.dependencies.push({
              ...child,
              packageName: resolved.name,
              version: resolved.version,
            });
          }
          node.dependencies.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.packageName.localeCompare(b.packageName) || compareNpmVersions(a.version, b.version));
          return node;
        })(),
      );
    }
    return resolving.get(key);
  };
  const roots = [];
  for (const declaration of dependencyDeclarations(source)) {
    const resolved = await resolveDeclaration(declaration);
    roots.push({
      ...declaration,
      packageName: resolved.name,
      version: resolved.version,
    });
  }
  roots.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) || a.packageName.localeCompare(b.packageName) || compareNpmVersions(a.version, b.version));
  await Promise.all(resolving.values());
  const dependencyClosure = [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name) || compareNpmVersions(a.version, b.version));
  return {
    dependencyRoots: roots,
    dependencyClosure,
    closureDigest: digest({ dependencyRoots: roots, dependencyClosure }),
    closureComplete: true,
  };
}

export async function resolveNpmSource(stream, source, { fetchImpl = fetch, reuseSource } = {}) {
  if (typeof source.tarball !== 'string' || typeof source.integrity !== 'string' || typeof source.shasum !== 'string') throw new Error(`${stream.id}: npm release lacks dist evidence`);
  const [algorithm, expectedIntegrity] = source.integrity.split('-', 2);
  if (algorithm !== 'sha512' || expectedIntegrity === undefined) throw new Error(`${stream.id}: npm release does not publish sha512 integrity`);
  const canReuseRoot =
    reuseSource?.tarball === source.tarball &&
    reuseSource?.integrity === source.integrity &&
    reuseSource?.shasum === source.shasum &&
    typeof reuseSource?.tarballSha256 === 'string' &&
    SHA256.test(reuseSource.tarballSha256);
  const bytes = canReuseRoot ? null : await downloadVerifiedNpmTarball(source, fetchImpl);
  const closure =
    stream.monitorDependencyClosure === true
      ? await resolveNpmDependencyClosure(source, {
          fetchImpl,
          reuseClosure: reuseSource?.dependencyClosure,
        })
      : {
          dependencyRoots: [],
          dependencyClosure: [],
          closureDigest: digest({ dependencyRoots: [], dependencyClosure: [] }),
          closureComplete: true,
        };
  return {
    ...source,
    tarballSha256: canReuseRoot ? reuseSource.tarballSha256 : createHash('sha256').update(bytes).digest('hex'),
    ...closure,
  };
}

async function resolvePypiSource(stream, source) {
  if (typeof source.url !== 'string' || typeof source.sha256 !== 'string') throw new Error(`${stream.id}: PyPI release lacks a selected artifact`);
  await verifiedDownload(source.url, source.sha256, 'sha256');
  return source;
}

export async function liveCatalogs(config) {
  const result = {};
  for (const stream of config.streams) {
    if (stream.registry === 'go') result[stream.id] = await goCatalog(stream);
    else if (stream.registry === 'crates.io') result[stream.id] = await cratesCatalog(stream);
    else if (stream.registry === 'npm') result[stream.id] = await npmCatalog(stream);
    else if (stream.registry === 'pypi') result[stream.id] = await pypiCatalog(stream);
    else throw new Error(`${stream.id}: unsupported registry ${stream.registry}`);
  }
  return result;
}

async function main(argv) {
  let output = join(root, 'upstream-candidates', 'candidate-registry.json');
  let catalogPath;
  let ledgerPath = join(root, 'compatibility/certified-upstreams.json');
  let assessmentsPath = join(root, 'compatibility/candidate-assessments.json');
  let maximum;
  let streamId;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output') output = resolve(argv[++i]);
    else if (argv[i] === '--catalog') catalogPath = resolve(argv[++i]);
    else if (argv[i] === '--ledger') ledgerPath = resolve(argv[++i]);
    else if (argv[i] === '--assessments') assessmentsPath = resolve(argv[++i]);
    else if (argv[i] === '--max') maximum = Number(argv[++i]);
    else if (argv[i] === '--stream') streamId = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const config = JSON.parse(await readFile(join(root, 'compatibility/upstream-patches.json'), 'utf8'));
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const assessments = JSON.parse(await readFile(assessmentsPath, 'utf8'));
  ledger.streams ??= {};
  const catalogs = catalogPath === undefined ? await liveCatalogs(config) : JSON.parse(await readFile(catalogPath, 'utf8')).streams;
  const registry = await selectCandidates({
    config,
    ledger,
    assessments,
    catalogs,
    maximum,
    streamId,
    ...(catalogPath === undefined ? { sourceResolver: resolveSource } : {}),
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, canonicalJson(registry));
  process.stdout.write(`${registry.candidates.length} selected, ${registry.backlog} queued\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
