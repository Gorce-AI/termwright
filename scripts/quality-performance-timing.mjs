export function summarizeQualityTiming(manifests) {
  const ordered = orderTimingManifests(manifests);
  const attempts = ordered.map(timingAttempt);
  return {
    firstRunPreAttemptMs: attempts[0].startedAfterRunMs,
    postStartupRunOrchestrationMs: average(ordered.slice(1).map((manifest, index) =>
      orchestrationDuration(manifest, attempts[index + 1]))),
  };
}

function orderTimingManifests(values) {
  const entries = values.map((manifest) => {
    const configurations = manifest.events.filter((event) => event.type === 'run.configuration');
    if (configurations.length !== 1) throw new Error(`timing run ${manifest.runId} lacks one configuration event`);
    return { manifest, configuration: configurations[0] };
  });
  const first = entries[0];
  if (first === undefined) throw new Error('timing soak produced no manifests');
  for (const { manifest, configuration } of entries) {
    if (manifest.invocationId !== first.manifest.invocationId
      || configuration.producerId !== first.configuration.producerId
      || configuration.epoch !== first.configuration.epoch) {
      throw new Error('timing soak manifests do not share one logical host invocation');
    }
  }
  entries.sort((left, right) => left.configuration.seq - right.configuration.seq);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].configuration.seq <= entries[index - 1].configuration.seq) {
      throw new Error('timing soak configuration sequence is not strictly increasing');
    }
  }
  return entries.map(({ manifest }) => manifest);
}

function timingAttempt(manifest) {
  if (manifest.status !== 'passed' || manifest.attempts.length !== 1) {
    throw new Error(`timing run ${manifest.runId} must contain exactly one passed attempt`);
  }
  const attempt = manifest.attempts[0];
  if (attempt.status !== 'passed' || attempt.retry !== 0 || attempt.repeat !== 0
    || !Number.isFinite(attempt.durationMs) || !Number.isFinite(attempt.startedAfterRunMs)
    || !Number.isFinite(attempt.finishedAfterRunMs) || attempt.durationMs < 0
    || attempt.startedAfterRunMs < 0 || attempt.finishedAfterRunMs < attempt.startedAfterRunMs) {
    throw new Error(`timing run ${manifest.runId} contains an invalid attempt`);
  }
  if (!Number.isFinite(manifest.durationMs) || manifest.durationMs < attempt.startedAfterRunMs
    || manifest.durationMs < attempt.finishedAfterRunMs) {
    throw new Error(`timing run ${manifest.runId} contains an invalid host-monotonic duration`);
  }
  return attempt;
}

function orchestrationDuration(manifest, attempt) {
  const duration = manifest.durationMs - (attempt.finishedAfterRunMs - attempt.startedAfterRunMs);
  if (duration < 0) throw new Error(`timing run ${manifest.runId} attempt exceeds its host duration`);
  return duration;
}

function average(values) {
  if (values.length === 0) throw new Error('at least one post-startup timing run is required');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
