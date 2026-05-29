/** LG Horizon data models (port of lghorizon_models.py, minus auth/service-config). */

type Json = Record<string, any>;

/** Look up an enum value by its (case-insensitive) name, with a fallback. */
function parseEnum<T extends Record<string, string>>(
  enumObj: T,
  value: unknown,
  fallback: T[keyof T],
): T[keyof T] {
  if (typeof value !== 'string') return fallback;
  const upper = value.toUpperCase();
  for (const key of Object.keys(enumObj)) {
    if (key.toUpperCase() === upper) return enumObj[key as keyof T];
  }
  return fallback;
}

// --------------------------------------------------------------------------
// Enums
// --------------------------------------------------------------------------

export enum LGHorizonRunningState {
  UNKNOWN = 'UNKNOWN',
  ONLINE_RUNNING = 'ONLINE_RUNNING',
  ONLINE_STANDBY = 'ONLINE_STANDBY',
  OFFLINE_NETWORK_STANDBY = 'OFFLINE_NETWORK_STANDBY',
  OFFLINE = 'OFFLINE',
}

export enum LGHorizonMessageType {
  UNKNOWN = 'UNKNOWN',
  STATUS = 'STATUS',
  UI_STATUS = 'UI_STATUS',
}

export enum LGHorizonRecordingSource {
  SHOW = 'SHOW',
  SINGLE = 'SINGLE',
  SEASON = 'SEASON',
  UNKNOWN = 'UNKNOWN',
}

export enum LGHorizonRecordingState {
  RECORDED = 'RECORDED',
  ONGOING = 'ONGOING',
  UNKNOWN = 'UNKNOWN',
}

export enum LGHorizonRecordingType {
  SINGLE = 'SINGLE',
  SEASON = 'SEASON',
  SHOW = 'SHOW',
  UNKNOWN = 'UNKNOWN',
}

export enum LGHorizonUIStateType {
  MAINUI = 'MAINUI',
  APPS = 'APPS',
  UNKNOWN = 'UNKNOWN',
}

export enum LGHorizonMediaType {
  UNKNOWN = 'UNKNOWN',
  CHANNEL = 'CHANNEL',
  APP = 'APP',
  MOVIE = 'MOVIE',
  EPISODE = 'EPISODE',
  TVSHOW = 'TVSHOW',
}

export enum LGHorizonSourceType {
  LINEAR = 'LINEAR',
  REVIEWBUFFER = 'REVIEWBUFFER',
  NDVR = 'NDVR',
  LOCALDVR = 'LOCALDVR',
  REPLAY = 'REPLAY',
  VOD = 'VOD',
  UNKNOWN = 'UNKNOWN',
}

export enum LGHorizonVODType {
  ASSET = 'ASSET',
  EPISODE = 'EPISODE',
  UNKNOWN = 'UNKNOWN',
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

export abstract class LGHorizonMessage {
  protected _topic: string;
  protected _payload: Json;

  constructor(topic: string, payload: Json) {
    this._topic = topic;
    this._payload = payload;
  }

  get topic(): string {
    return this._topic;
  }

  get payload(): Json {
    return this._payload;
  }

  abstract get messageType(): LGHorizonMessageType;
}

export class LGHorizonStatusMessage extends LGHorizonMessage {
  constructor(payload: Json, topic: string) {
    super(topic, payload);
  }

  get messageType(): LGHorizonMessageType {
    return LGHorizonMessageType.STATUS;
  }

  get source(): string {
    return this._payload.source ?? 'unknown';
  }

  get runningState(): LGHorizonRunningState {
    return parseEnum(
      LGHorizonRunningState,
      this._payload.state ?? 'unknown',
      LGHorizonRunningState.UNKNOWN,
    );
  }
}

export class LGHorizonUIStatusMessage extends LGHorizonMessage {
  private _status: LGHorizonUIState | null = null;

  constructor(payload: Json, topic: string) {
    super(topic, payload);
  }

  get messageType(): LGHorizonMessageType {
    return LGHorizonMessageType.UI_STATUS;
  }

  get source(): string {
    return this._payload.source ?? 'unknown';
  }

  /** Message timestamp in seconds. */
  get messageTimestamp(): number {
    const val = this._payload.messageTimeStamp ?? 0;
    return val ? val / 1000 : 0;
  }

  get uiState(): LGHorizonUIState | null {
    if (!this._status && 'status' in this._payload) {
      this._status = new LGHorizonUIState(this._payload.status);
    }
    return this._status;
  }
}

export class LGHorizonUnknownMessage extends LGHorizonMessage {
  constructor(payload: Json, topic: string) {
    super(topic, payload);
  }

  get messageType(): LGHorizonMessageType {
    return LGHorizonMessageType.UNKNOWN;
  }
}

// --------------------------------------------------------------------------
// Sources
// --------------------------------------------------------------------------

export abstract class LGHorizonSource {
  protected _raw: Json;
  constructor(raw: Json) {
    this._raw = raw;
  }
  abstract get sourceType(): LGHorizonSourceType;
}

export class LGHorizonLinearSource extends LGHorizonSource {
  get channelId(): string {
    return this._raw.channelId ?? '';
  }
  get eventId(): string {
    return this._raw.eventId ?? '';
  }
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.LINEAR;
  }
}

export class LGHorizonReviewBufferSource extends LGHorizonSource {
  get channelId(): string {
    return this._raw.channelId ?? '';
  }
  get eventId(): string {
    return this._raw.eventId ?? '';
  }
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.REVIEWBUFFER;
  }
}

export class LGHorizonAdBreak {
  constructor(
    public startMs: number,
    public endMs: number,
    public adType: string,
    public isSkippable: boolean,
    public hasCounter: boolean,
  ) {}

  get durationMs(): number {
    return this.endMs - this.startMs;
  }
  get startS(): number {
    return this.startMs / 1000;
  }
  get endS(): number {
    return this.endMs / 1000;
  }
}

export class LGHorizonNDVRSource extends LGHorizonSource {
  get recordingId(): string {
    return this._raw.recordingId ?? '';
  }
  get channelId(): string {
    return this._raw.channelId ?? '';
  }
  get adManifest(): LGHorizonAdBreak[] {
    const raw = this._raw.adManifest ?? [];
    return raw.map(
      (entry: Json) =>
        new LGHorizonAdBreak(
          entry.dStart ?? 0,
          entry.dEnd ?? 0,
          entry.adType ?? 'UNKNOWN',
          entry.isSkippable ?? false,
          entry.adCounter ?? false,
        ),
    );
  }
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.NDVR;
  }
}

export class LGHorizonVODSource extends LGHorizonSource {
  get titleId(): string {
    return this._raw.titleId ?? '';
  }
  get startIntroTime(): number {
    return this._raw.startIntroTime ?? 0;
  }
  get endIntroTime(): number {
    return this._raw.endIntroTime ?? 0;
  }
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.VOD;
  }
}

export class LGHorizonReplaySource extends LGHorizonSource {
  get eventId(): string {
    return this._raw.eventId ?? '';
  }
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.REPLAY;
  }
}

export class LGHorizonUnknownSource extends LGHorizonSource {
  get sourceType(): LGHorizonSourceType {
    return LGHorizonSourceType.UNKNOWN;
  }
}

// --------------------------------------------------------------------------
// Player / UI / Apps state
// --------------------------------------------------------------------------

export class LGHorizonPlayerState {
  private _raw: Json;
  constructor(raw: Json) {
    this._raw = raw;
  }

  get sourceType(): LGHorizonSourceType {
    return parseEnum(
      LGHorizonSourceType,
      this._raw.sourceType ?? 'unknown',
      LGHorizonSourceType.UNKNOWN,
    );
  }

  get speed(): number {
    return this._raw.speed ?? 0;
  }

  /** Last speed change time in seconds (or null). */
  get lastSpeedChangeTime(): number | null {
    const val = this._raw.lastSpeedChangeTime;
    return val !== undefined && val !== null ? val / 1000 : null;
  }

  get relativePosition(): number {
    return this._raw.relativePosition ?? 0;
  }

  get source(): LGHorizonSource | null {
    if ('source' in this._raw) {
      switch (this.sourceType) {
        case LGHorizonSourceType.LINEAR:
          return new LGHorizonLinearSource(this._raw.source);
        case LGHorizonSourceType.VOD:
          return new LGHorizonVODSource(this._raw.source);
        case LGHorizonSourceType.REPLAY:
          return new LGHorizonReplaySource(this._raw.source);
        case LGHorizonSourceType.NDVR:
          return new LGHorizonNDVRSource(this._raw.source);
        case LGHorizonSourceType.REVIEWBUFFER:
          return new LGHorizonReviewBufferSource(this._raw.source);
        default:
          return null;
      }
    }
    return null;
  }
}

export class LGHorizonAppsState {
  private _raw: Json;
  constructor(raw: Json) {
    this._raw = raw;
  }
  get id(): string {
    return this._raw.id ?? '';
  }
  get appName(): string {
    return this._raw.appName ?? '';
  }
  get logoPath(): string {
    return this._raw.logoPath ?? '';
  }
}

export class LGHorizonUIState {
  private _raw: Json;
  private _playerState: LGHorizonPlayerState | null = null;
  private _appsState: LGHorizonAppsState | null = null;

  constructor(raw: Json) {
    this._raw = raw;
  }

  get uiStatus(): LGHorizonUIStateType {
    return parseEnum(
      LGHorizonUIStateType,
      this._raw.uiStatus ?? 'unknown',
      LGHorizonUIStateType.UNKNOWN,
    );
  }

  get playerState(): LGHorizonPlayerState | null {
    if (this._playerState === null && 'playerState' in this._raw) {
      this._playerState = new LGHorizonPlayerState(this._raw.playerState);
    }
    return this._playerState;
  }

  get appsState(): LGHorizonAppsState | null {
    if (this._appsState === null && 'appsState' in this._raw) {
      this._appsState = new LGHorizonAppsState(this._raw.appsState);
    }
    return this._appsState;
  }
}

// --------------------------------------------------------------------------
// Profile / Customer / Entitlements
// --------------------------------------------------------------------------

export class LGHorizonProfileOptions {
  constructor(private _raw: Json) {}
  get lang(): string {
    return this._raw.lang;
  }
}

export class LGHorizonProfile {
  private _options: LGHorizonProfileOptions;
  constructor(private _raw: Json) {
    this._options = new LGHorizonProfileOptions(this._raw.options);
  }
  get id(): string {
    return this._raw.profileId;
  }
  get name(): string {
    return this._raw.name;
  }
  get favoriteChannels(): string[] {
    return this._raw.favoriteChannels ?? [];
  }
  get options(): LGHorizonProfileOptions {
    return this._options;
  }
}

export class LGHorizonCustomer {
  private _profiles: Record<string, LGHorizonProfile> = {};
  constructor(private _raw: Json) {}

  get customerId(): string {
    return this._raw.customerId;
  }
  get hashedCustomerId(): string {
    return this._raw.hashedCustomerId;
  }
  get countryId(): string {
    return this._raw.countryId;
  }
  get cityId(): number {
    return this._raw.cityId;
  }
  get recordingRetentionPeriod(): number | null {
    return this._raw.recordingRetentionPeriod ?? null;
  }
  get hasCloudRecording(): boolean {
    const r = this.recordingRetentionPeriod;
    return !!r && r > 0;
  }
  /** Raw set-top box definitions assigned to this household. */
  get assignedDevices(): Json[] {
    return this._raw.assignedDevices ?? [];
  }
  get profiles(): Record<string, LGHorizonProfile> {
    if (Object.keys(this._profiles).length === 0) {
      for (const p of this._raw.profiles ?? []) {
        this._profiles[p.profileId] = new LGHorizonProfile(p);
      }
    }
    return this._profiles;
  }
  getProfileLang(profileId: string | null): string {
    if (!profileId || !(profileId in this.profiles)) {
      return 'nl';
    }
    return this.profiles[profileId].options.lang;
  }
}

export class LGHorizonEntitlements {
  constructor(private _raw: Json) {}
  get entitlements(): Json[] {
    return this._raw.entitlements ?? [];
  }
  get entitlementIds(): string[] {
    return this.entitlements.filter((e) => 'id' in e).map((e) => e.id);
  }
  get features(): string[] {
    return this._raw.features ?? [];
  }
  get hasPvr(): boolean {
    return this.features.includes('PVR');
  }
  get hasLocalDvr(): boolean {
    return this.features.includes('LOCALDVR');
  }
  get hasRecording(): boolean {
    return this.hasPvr || this.hasLocalDvr;
  }
}

// --------------------------------------------------------------------------
// Channel
// --------------------------------------------------------------------------

export class LGHorizonChannel {
  constructor(private _raw: Json) {}
  get id(): string {
    return this._raw.id;
  }
  get channelNumber(): string {
    return this._raw.logicalChannelNumber;
  }
  get replayPrePadding(): number {
    return this._raw.replayPrePadding ?? 0;
  }
  get replayPostPadding(): number {
    return this._raw.replayPostPadding ?? 0;
  }
  get isRadio(): boolean {
    return this._raw.isRadio ?? false;
  }
  get title(): string {
    return this._raw.name;
  }
  get logoImage(): string {
    if (this._raw.logo && this._raw.logo.focused) {
      return this._raw.logo.focused;
    }
    return '';
  }
  get linearProducts(): string[] {
    return this._raw.linearProducts ?? [];
  }
  get streamImage(): string {
    const imageStream = this._raw.imageStream ?? {};
    if (imageStream.full) return imageStream.full;
    if (imageStream.small) return imageStream.small;
    if (this._raw.logo && this._raw.logo.focused) return this._raw.logo.focused;
    return '';
  }
}

// --------------------------------------------------------------------------
// Device state
// --------------------------------------------------------------------------

export class LGHorizonDeviceState {
  state: LGHorizonRunningState = LGHorizonRunningState.UNKNOWN;
  sourceType: LGHorizonSourceType = LGHorizonSourceType.UNKNOWN;
  uiStateType: LGHorizonUIStateType = LGHorizonUIStateType.UNKNOWN;
  mediaType: LGHorizonMediaType = LGHorizonMediaType.UNKNOWN;
  id: string | null = null;
  channelId: string | null = null;
  channelName: string | null = null;
  showTitle: string | null = null;
  appName: string | null = null;
  episodeTitle: string | null = null;
  episodeNumber: number | null = null;
  seasonNumber: number | null = null;
  image: string | null = null;
  speed: number | null = null;
  position: number | null = null;
  duration: number | null = null;
  startTime: number | null = null;
  endTime: number | null = null;
  lastPositionUpdate: number | null = null;
  adBreaks: LGHorizonAdBreak[] = [];

  private _lastGoodLinearMetadata: Json = {};

  get paused(): boolean {
    if (this.speed === null) return false;
    return this.speed === 0;
  }

  get isInAdBreak(): boolean {
    if (this.adBreaks.length === 0 || this.position === null) return false;
    const positionMs = Math.floor(this.position * 1000);
    return this.adBreaks.some((ab) => ab.startMs <= positionMs && positionMs < ab.endMs);
  }

  get currentAdBreakEnd(): number | null {
    if (this.adBreaks.length === 0 || this.position === null) return null;
    const positionMs = Math.floor(this.position * 1000);
    for (const ab of this.adBreaks) {
      if (ab.startMs <= positionMs && positionMs < ab.endMs) return ab.endS;
    }
    return null;
  }

  resetProgress(): void {
    this.position = null;
    this.duration = null;
    this.startTime = null;
    this.endTime = null;
    this.lastPositionUpdate = null;
  }

  reset(): void {
    this.id = null;
    this.channelId = null;
    this.channelName = null;
    this.showTitle = null;
    this.appName = null;
    this.episodeTitle = null;
    this.episodeNumber = null;
    this.seasonNumber = null;
    this.image = null;
    this.speed = null;
    this.sourceType = LGHorizonSourceType.UNKNOWN;
    this.uiStateType = LGHorizonUIStateType.UNKNOWN;
    this.mediaType = LGHorizonMediaType.UNKNOWN;
    this.adBreaks = [];
    this.resetProgress();
  }

  cacheLinearMetadata(): void {
    if (!this.channelName || !this.showTitle) return;
    this._lastGoodLinearMetadata = {
      channelId: this.channelId,
      channelName: this.channelName,
      showTitle: this.showTitle,
      episodeTitle: this.episodeTitle,
      seasonNumber: this.seasonNumber,
      episodeNumber: this.episodeNumber,
      image: this.image,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      position: this.position,
      lastPositionUpdate: this.lastPositionUpdate,
      sourceType: this.sourceType,
      mediaType: this.mediaType,
    };
  }

  restoreLinearMetadata(): boolean {
    if (Object.keys(this._lastGoodLinearMetadata).length === 0) return false;
    const m = this._lastGoodLinearMetadata;
    this.channelId = m.channelId ?? null;
    this.channelName = m.channelName ?? null;
    this.showTitle = m.showTitle ?? null;
    this.episodeTitle = m.episodeTitle ?? null;
    this.seasonNumber = m.seasonNumber ?? null;
    this.episodeNumber = m.episodeNumber ?? null;
    this.image = m.image ?? null;
    this.startTime = m.startTime ?? null;
    this.endTime = m.endTime ?? null;
    this.duration = m.duration ?? null;
    this.position = m.position ?? null;
    this.lastPositionUpdate = m.lastPositionUpdate ?? null;
    this.sourceType = m.sourceType ?? LGHorizonSourceType.LINEAR;
    this.mediaType = m.mediaType ?? LGHorizonMediaType.CHANNEL;
    return true;
  }

  clearLinearMetadataCache(): void {
    this._lastGoodLinearMetadata = {};
  }

  static isLauncherApp(appName: string, logoPath: string): boolean {
    if (!appName) return false;
    const nameLower = appName.toLowerCase();
    const logoLower = (logoPath || '').toLowerCase();
    if (nameLower.includes('launcher')) return true;
    if (logoLower.includes('appstore')) return true;
    return false;
  }
}

// --------------------------------------------------------------------------
// Replay event / VOD
// --------------------------------------------------------------------------

export class LGHorizonReplayEvent {
  constructor(private _raw: Json) {}
  get episodeNumber(): number | null {
    return this._raw.episodeNumber ?? null;
  }
  get channelId(): string {
    return this._raw.channelId;
  }
  get eventId(): string {
    return this._raw.eventId;
  }
  get seasonNumber(): number | null {
    return this._raw.seasonNumber ?? null;
  }
  get startTime(): number | null {
    return this._raw.startTime ?? null;
  }
  get endTime(): number | null {
    return this._raw.endTime ?? null;
  }
  get title(): string {
    return this._raw.title;
  }
  get episodeName(): string | null {
    return this._raw.episodeName ?? null;
  }
  get fullEpisodeTitle(): string | null {
    if (!this.seasonNumber && !this.episodeNumber) return null;
    const s = String(this.seasonNumber ?? 0).padStart(2, '0');
    const e = String(this.episodeNumber ?? 0).padStart(2, '0');
    let full = `S${s}E${e}`;
    if (this.episodeName) full += `: ${this.episodeName}`;
    return full;
  }
}

export class LGHorizonVOD {
  constructor(private _raw: Json) {}
  get vodType(): LGHorizonVODType {
    return parseEnum(LGHorizonVODType, this._raw.type ?? 'unknown', LGHorizonVODType.UNKNOWN);
  }
  get id(): string {
    return this._raw.id;
  }
  get season(): number | null {
    return this._raw.season ?? null;
  }
  get episode(): number | null {
    return this._raw.episode ?? null;
  }
  get title(): string {
    return this._raw.title;
  }
  get seriesTitle(): string | null {
    return this._raw.seriesTitle ?? null;
  }
  get duration(): number {
    return this._raw.duration;
  }
}

export class LGHorizonRelevantEpisode {
  constructor(private _raw: Json) {}
  get recordingState(): LGHorizonRecordingState {
    return parseEnum(
      LGHorizonRecordingState,
      this._raw.recordingState ?? 'unknown',
      LGHorizonRecordingState.UNKNOWN,
    );
  }
  get seasonNumber(): number | null {
    return this._raw.seasonNumber ?? null;
  }
  get episodeNumber(): number | null {
    return this._raw.episodeNumber ?? null;
  }
}

// --------------------------------------------------------------------------
// Recordings
// --------------------------------------------------------------------------

export abstract class LGHorizonRecording {
  protected _raw: Json;
  constructor(raw: Json) {
    this._raw = raw;
  }
  get recordingPayload(): Json {
    return this._raw;
  }
  get recordingState(): LGHorizonRecordingState {
    return parseEnum(
      LGHorizonRecordingState,
      this._raw.recordingState ?? 'unknown',
      LGHorizonRecordingState.UNKNOWN,
    );
  }
  get source(): LGHorizonRecordingSource {
    return parseEnum(
      LGHorizonRecordingSource,
      this._raw.source ?? 'unknown',
      LGHorizonRecordingSource.UNKNOWN,
    );
  }
  get type(): LGHorizonRecordingType {
    return parseEnum(
      LGHorizonRecordingType,
      this._raw.type ?? 'unknown',
      LGHorizonRecordingType.UNKNOWN,
    );
  }
  get id(): string {
    return this._raw.id;
  }
  get title(): string {
    return this._raw.title ?? 'unknown';
  }
  get channelId(): string | null {
    return this._raw.channelId ?? null;
  }
  get recordingType(): string {
    return this._raw.recordingType ?? '';
  }
  get cpeId(): string | null {
    return this._raw.cpeId ?? null;
  }
  get isLocalRecording(): boolean {
    return this.cpeId !== null;
  }
  get posterUrl(): string | null {
    const poster = this._raw.poster;
    return poster ? poster.url ?? null : null;
  }
}

export class LGHorizonRecordingSingle extends LGHorizonRecording {
  get episodeTitle(): string | null {
    return this._raw.episodeTitle ?? null;
  }
  get episodeId(): string | null {
    return this._raw.episodeId ?? null;
  }
  get seasonNumber(): number | null {
    return this._raw.seasonNumber ?? null;
  }
  get episodeNumber(): number | null {
    return this._raw.episodeNumber ?? null;
  }
  get showId(): string | null {
    return this._raw.showId ?? null;
  }
  get showTitle(): string | null {
    return this._raw.showTitle ?? null;
  }
  get seasonId(): string | null {
    return this._raw.seasonId ?? null;
  }
  get duration(): number | null {
    return this._raw.duration ?? null;
  }
  get startTime(): string | null {
    return this._raw.startTime ?? null;
  }
  get endTime(): string | null {
    return this._raw.endTime ?? null;
  }
}

export class LGHorizonRecordingSeason extends LGHorizonRecording {
  private _mostRelevantEpisode: LGHorizonRelevantEpisode | null;
  constructor(raw: Json) {
    super(raw);
    const ep = raw.mostRelevantEpisode;
    this._mostRelevantEpisode = ep ? new LGHorizonRelevantEpisode(ep) : null;
  }
  get noOfEpisodes(): number {
    return this._raw.noOfEpisodes ?? 0;
  }
  get seasonTitle(): string {
    return this._raw.seasonTitle ?? '';
  }
  get showId(): string {
    return this._raw.showId ?? '';
  }
  get mostRelevantEpisode(): LGHorizonRelevantEpisode | null {
    return this._mostRelevantEpisode;
  }
}

export class LGHorizonRecordingShow extends LGHorizonRecording {
  private _mostRelevantEpisode: LGHorizonRelevantEpisode | null;
  constructor(raw: Json) {
    super(raw);
    const ep = raw.mostRelevantEpisode;
    this._mostRelevantEpisode = ep ? new LGHorizonRelevantEpisode(ep) : null;
  }
  get noOfEpisodes(): number {
    return this._raw.noOfEpisodes ?? 0;
  }
  get mostRelevantEpisode(): LGHorizonRelevantEpisode | null {
    return this._mostRelevantEpisode;
  }
}

export class LGHorizonRecordingList {
  protected _recordings: LGHorizonRecording[];
  constructor(recordings: LGHorizonRecording[]) {
    this._recordings = recordings;
  }
  get total(): number {
    return this._recordings.length;
  }
  get recordings(): LGHorizonRecording[] {
    return this._recordings;
  }
}

export class LGHorizonShowRecordingList extends LGHorizonRecordingList {
  constructor(
    private _showTitle: string | null,
    private _showImage: string | null,
    recordings: LGHorizonRecording[],
  ) {
    super(recordings);
  }
  get showTitle(): string | null {
    return this._showTitle;
  }
  get showImage(): string | null {
    return this._showImage;
  }
}

export class LGHorizonRecordingQuota {
  constructor(private _raw: Json) {}
  get quota(): number {
    return this._raw.quota ?? 0;
  }
  get occupied(): number {
    return this._raw.occupied ?? 0;
  }
  get percentageUsed(): number {
    if (this.quota === 0) return 0;
    return (this.occupied / this.quota) * 100;
  }
}

// --------------------------------------------------------------------------
// EPG / replay / managed recordings
// --------------------------------------------------------------------------

export class LGHorizonEpgEvent {
  constructor(private _raw: Json, private _channelId: string) {}
  get eventId(): string {
    return this._raw.id ?? '';
  }
  get channelId(): string {
    return this._channelId;
  }
  get title(): string {
    return this._raw.title ?? '';
  }
  get startTime(): number | null {
    return this._raw.startTime ?? null;
  }
  get endTime(): number | null {
    return this._raw.endTime ?? null;
  }
  get minimumAge(): number {
    return this._raw.minimumAge ?? 0;
  }
  get isPlaceholder(): boolean {
    return this._raw.isPlaceHolder ?? false;
  }
  get mergedId(): string | null {
    return this._raw.mergedId ?? null;
  }
  get audioLanguages(): string[] {
    const langs = this._raw.audioLanguages ?? [];
    return langs.filter((i: any) => i && typeof i === 'object').map((i: Json) => i.lang ?? '');
  }
}

export class LGHorizonEpgEntry {
  private _events: LGHorizonEpgEvent[];
  constructor(private _raw: Json) {
    const channelId = _raw.channelId ?? '';
    this._events = (_raw.events ?? []).map(
      (ev: Json) => new LGHorizonEpgEvent(ev, channelId),
    );
  }
  get channelId(): string {
    return this._raw.channelId ?? '';
  }
  get events(): LGHorizonEpgEvent[] {
    return this._events;
  }
}

export class LGHorizonEpg {
  constructor(private _entries: LGHorizonEpgEntry[]) {}
  get entries(): LGHorizonEpgEntry[] {
    return this._entries;
  }
  getChannelEvents(channelId: string): LGHorizonEpgEvent[] {
    for (const entry of this._entries) {
      if (entry.channelId === channelId) return entry.events;
    }
    return [];
  }
}

export class LGHorizonEventDetail {
  constructor(private _raw: Json) {}
  get eventId(): string {
    return this._raw.eventId ?? '';
  }
  get channelId(): string {
    return this._raw.channelId ?? '';
  }
  get title(): string {
    return this._raw.title ?? '';
  }
  get episodeName(): string | null {
    return this._raw.episodeName ?? null;
  }
  get shortDescription(): string | null {
    return this._raw.shortDescription ?? null;
  }
  get longDescription(): string | null {
    return this._raw.longDescription ?? null;
  }
  get description(): string | null {
    return this.longDescription || this.shortDescription;
  }
  get genres(): string[] {
    return this._raw.genres ?? [];
  }
  get seasonNumber(): number | null {
    return this._raw.seasonNumber ?? null;
  }
  get episodeNumber(): number | null {
    return this._raw.episodeNumber ?? null;
  }
  get startTime(): number | null {
    return this._raw.startTime ?? null;
  }
  get endTime(): number | null {
    return this._raw.endTime ?? null;
  }
  get actors(): string[] {
    return this._raw.actors ?? [];
  }
  get directors(): string[] {
    return this._raw.directors ?? [];
  }
  get minimumAge(): string | null {
    return this._raw.minimumAge ?? null;
  }
}

export class LGHorizonReplayChannel {
  constructor(private _raw: Json) {}
  get id(): string {
    return this._raw.id ?? '';
  }
  get name(): string {
    return this._raw.name ?? '';
  }
  get logo(): string {
    return this._raw.logo ?? '';
  }
}

export class LGHorizonManagedRecording {
  constructor(private _raw: Json) {}
  get id(): string {
    return this._raw.id ?? '';
  }
  get title(): string {
    return this._raw.title ?? '';
  }
  get showName(): string | null {
    return this._raw.showName ?? null;
  }
  get seasonName(): string | null {
    return this._raw.seasonName ?? null;
  }
  get itemType(): string {
    return this._raw.itemType ?? '';
  }
  get recordingState(): string {
    return this._raw.recordingState ?? '';
  }
  get recordingType(): string {
    return this._raw.recordingType ?? '';
  }
  get channelId(): string | null {
    return this._raw.channelId ?? null;
  }
  get seasonNumber(): number | null {
    return this._raw.seasonNumber ?? null;
  }
  get episodeNumber(): number | null {
    return this._raw.episodeNumber ?? null;
  }
  get diskSpace(): number {
    return this._raw.diskSpace ?? 0;
  }
  get duration(): number | null {
    return this._raw.recDuration ?? null;
  }
  get startTime(): string | null {
    return this._raw.displayStartTime ?? this._raw.startTime ?? null;
  }
  get endTime(): string | null {
    return this._raw.displayEndTime ?? this._raw.endTime ?? null;
  }
  get deleteTime(): string | null {
    return this._raw.deleteTime ?? null;
  }
  get retentionPeriod(): number | null {
    return this._raw.retentionPeriod ?? null;
  }
  get isPremiere(): boolean {
    return this._raw.isPremiere ?? false;
  }
  get isAdult(): boolean {
    return this._raw.isAdult ?? false;
  }
}

export class LGHorizonManagedRecordingList {
  private _total: number;
  private _limit: number;
  private _offset: number;
  private _recordings: LGHorizonManagedRecording[];

  constructor(raw: Json) {
    this._total = raw.total ?? 0;
    this._limit = raw.limit ?? 0;
    this._offset = raw.offset ?? 0;
    this._recordings = (raw.data ?? []).map(
      (item: Json) => new LGHorizonManagedRecording(item),
    );
  }
  get total(): number {
    return this._total;
  }
  get limit(): number {
    return this._limit;
  }
  get offset(): number {
    return this._offset;
  }
  get recordings(): LGHorizonManagedRecording[] {
    return this._recordings;
  }
  get totalDiskSpace(): number {
    return this._recordings.reduce((acc, r) => acc + r.diskSpace, 0);
  }
}

// --------------------------------------------------------------------------
// Services config
// --------------------------------------------------------------------------

export class LGHorizonServicesConfig {
  constructor(private _config: Json) {}

  getServiceUrl(serviceName: string): string {
    const svc = this._config[serviceName];
    if (svc && typeof svc === 'object' && 'URL' in svc) {
      return svc.URL;
    }
    throw new Error(`Service URL for '${serviceName}' not found in configuration`);
  }

  getAllServices(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, service] of Object.entries(this._config)) {
      if (service && typeof service === 'object' && (service as Json).URL) {
        out[name] = (service as Json).URL;
      }
    }
    return out;
  }
}
