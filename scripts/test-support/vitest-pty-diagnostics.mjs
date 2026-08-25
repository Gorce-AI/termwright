const CLOSED_CHANNEL = /\bchannel (?:closed|is closed)\b|\bERR_IPC_CHANNEL_CLOSED\b/iu;

export function hasClosedChannelDiagnostic(output) {
  return CLOSED_CHANNEL.test(output);
}

export function isVitestPtyCellFailure(result) {
  return result.code !== 0 || !result.telemetryValid || result.channelClosed;
}
