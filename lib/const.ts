/** Constants for the LGHorizon / Ziggo Next integration (port of const.py). */

export const BOX_PLAY_STATE_CHANNEL = 'linear';
export const BOX_PLAY_STATE_REPLAY = 'replay';
export const BOX_PLAY_STATE_DVR = 'nDVR';
export const BOX_PLAY_STATE_BUFFER = 'reviewbuffer';
export const BOX_PLAY_STATE_APP = 'app';
export const BOX_PLAY_STATE_VOD = 'VOD';

// --- Media keys (w3cKey values sent to the box) ---
export const MEDIA_KEY_POWER = 'Power';
export const MEDIA_KEY_STANDBY = 'Standby';
export const MEDIA_KEY_WAKEUP = 'WakeUp';

export const MEDIA_KEY_PLAY = 'MediaPlay';
export const MEDIA_KEY_PAUSE = 'MediaPause';
export const MEDIA_KEY_PLAY_PAUSE = 'MediaPlayPause';
export const MEDIA_KEY_STOP = 'MediaStop';
export const MEDIA_KEY_RECORD = 'MediaRecord';
export const MEDIA_KEY_FAST_FORWARD = 'MediaFastForward';
export const MEDIA_KEY_REWIND = 'MediaRewind';
export const MEDIA_KEY_TRACK_NEXT = 'MediaTrackNext';
export const MEDIA_KEY_TRACK_PREVIOUS = 'MediaTrackPrevious';

export const MEDIA_KEY_CHANNEL_UP = 'ChannelUp';
export const MEDIA_KEY_CHANNEL_DOWN = 'ChannelDown';
export const MEDIA_KEY_TOP_MENU = 'MediaTopMenu';
export const MEDIA_KEY_GUIDE = 'Guide';
export const MEDIA_KEY_HELP = 'Help';
export const MEDIA_KEY_INFO = 'Info';
export const MEDIA_KEY_CONTEXT_MENU = 'ContextMenu';
export const MEDIA_KEY_NEXT_USER_PROFILE = 'NextUserProfile';
export const MEDIA_KEY_TV = 'TV';
export const MEDIA_KEY_TELETEXT = 'Teletext';
export const MEDIA_KEY_SUBTITLE = 'Subtitle';
export const MEDIA_KEY_AUDIO_TRACK = 'AudioTrack';

export const MEDIA_KEY_ARROW_UP = 'ArrowUp';
export const MEDIA_KEY_ARROW_DOWN = 'ArrowDown';
export const MEDIA_KEY_ARROW_LEFT = 'ArrowLeft';
export const MEDIA_KEY_ARROW_RIGHT = 'ArrowRight';
export const MEDIA_KEY_ENTER = 'Enter';
export const MEDIA_KEY_ESCAPE = 'Escape';
export const MEDIA_KEY_BACKSPACE = 'Backspace';

export const MEDIA_KEY_RED = 'Red';
export const MEDIA_KEY_GREEN = 'Green';
export const MEDIA_KEY_YELLOW = 'Yellow';
export const MEDIA_KEY_BLUE = 'Blue';

/** Grouped media keys for UI/flow consumers. */
export const MEDIA_KEYS: Record<string, string[]> = {
  Power: [MEDIA_KEY_POWER, MEDIA_KEY_STANDBY, MEDIA_KEY_WAKEUP],
  Playback: [
    MEDIA_KEY_PLAY,
    MEDIA_KEY_PAUSE,
    MEDIA_KEY_PLAY_PAUSE,
    MEDIA_KEY_STOP,
    MEDIA_KEY_RECORD,
    MEDIA_KEY_FAST_FORWARD,
    MEDIA_KEY_REWIND,
    MEDIA_KEY_TRACK_NEXT,
    MEDIA_KEY_TRACK_PREVIOUS,
  ],
  Navigation: [
    MEDIA_KEY_CHANNEL_UP,
    MEDIA_KEY_CHANNEL_DOWN,
    MEDIA_KEY_TOP_MENU,
    MEDIA_KEY_GUIDE,
    MEDIA_KEY_HELP,
    MEDIA_KEY_INFO,
    MEDIA_KEY_CONTEXT_MENU,
    MEDIA_KEY_NEXT_USER_PROFILE,
    MEDIA_KEY_TV,
    MEDIA_KEY_TELETEXT,
    MEDIA_KEY_SUBTITLE,
    MEDIA_KEY_AUDIO_TRACK,
  ],
  'D-Pad': [
    MEDIA_KEY_ARROW_UP,
    MEDIA_KEY_ARROW_DOWN,
    MEDIA_KEY_ARROW_LEFT,
    MEDIA_KEY_ARROW_RIGHT,
    MEDIA_KEY_ENTER,
    MEDIA_KEY_ESCAPE,
    MEDIA_KEY_BACKSPACE,
  ],
  Colour: [MEDIA_KEY_RED, MEDIA_KEY_GREEN, MEDIA_KEY_YELLOW, MEDIA_KEY_BLUE],
  Digits: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
};

/** Flat list of every available media key. */
export const ALL_MEDIA_KEYS: string[] = Object.values(MEDIA_KEYS).flat();

export const RECORDING_TYPE_SINGLE = 'single';
export const RECORDING_TYPE_SHOW = 'show';
export const RECORDING_TYPE_SEASON = 'season';

export const PLATFORM_TYPES: Record<string, { manufacturer: string; model: string }> = {
  EOS: { manufacturer: 'Arris', model: 'DCX960' },
  EOS2: { manufacturer: 'HUMAX', model: '2008C-STB-TN' },
  HORIZON: { manufacturer: 'Arris', model: 'DCX960' },
  APOLLO: { manufacturer: 'Arris', model: 'VIP5002W' },
};

export interface CountrySetting {
  api_url: string;
  mqtt_url?: string;
  use_refreshtoken: boolean;
  name: string;
}

/**
 * Provider/country settings. Only `nl` (Ziggo) is exposed by this Homey app,
 * but the full table is kept so the ported library stays faithful to the source.
 */
export const COUNTRY_SETTINGS: Record<string, CountrySetting> = {
  nl: {
    api_url: 'https://spark-prod-nl.gnp.cloud.ziggogo.tv',
    mqtt_url: 'obomsg.prod.nl.horizon.tv',
    use_refreshtoken: false,
    name: 'Ziggo',
  },
  ch: {
    api_url: 'https://spark-prod-ch.gnp.cloud.sunrisetv.ch',
    use_refreshtoken: true,
    name: 'UPC Switzerland',
  },
  'be-basetv': {
    api_url: 'https://spark-prod-be.gnp.cloud.base.tv',
    use_refreshtoken: true,
    name: 'BASE TV (BE)',
  },
  'be-nl': {
    api_url: 'https://spark-prod-be.gnp.cloud.telenet.tv',
    use_refreshtoken: true,
    name: 'Telenet (BE)',
  },
  gb: {
    api_url: 'https://spark-prod-gb.gnp.cloud.virgintvgo.virginmedia.com',
    use_refreshtoken: true,
    name: 'Virgin Media (GB)',
  },
  ie: {
    api_url: 'https://spark-prod-ie.gnp.cloud.virginmediatv.ie',
    use_refreshtoken: false,
    name: 'Virgin Media (IE)',
  },
  pl: {
    api_url: 'https://spark-prod-pl.gnp.cloud.upctv.pl',
    use_refreshtoken: false,
    name: 'UPC (PL)',
  },
};
