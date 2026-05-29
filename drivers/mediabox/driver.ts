'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import { ALL_MEDIA_KEYS } from '../../lib/const';
import type ZiggoNextApp from '../../app';
import type MediaboxDevice from './device';

interface AutocompleteItem {
  name: string;
  id: string;
  description?: string;
}

export default class MediaboxDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this._registerActionCards();
    this._registerConditionCards();
    this.log('Mediabox driver initialized');
  }

  private get app(): ZiggoNextApp {
    return this.homey.app as ZiggoNextApp;
  }

  /** Register a run listener, tolerating any single card that fails to bind. */
  private _action(
    id: string,
    runListener: (args: any) => Promise<unknown> | unknown,
    autocomplete?: { arg: string; fn: (query: string, args: any) => unknown },
  ): void {
    try {
      const card = this.homey.flow.getActionCard(id);
      card.registerRunListener(runListener as any);
      if (autocomplete) {
        card
          .getArgument(autocomplete.arg)
          .registerAutocompleteListener(autocomplete.fn as any);
      }
    } catch (err) {
      this.error(`Failed to register action card '${id}'`, err);
    }
  }

  private _condition(
    id: string,
    runListener: (args: any) => Promise<unknown> | unknown,
    autocomplete?: { arg: string; fn: (query: string, args: any) => unknown },
  ): void {
    try {
      const card = this.homey.flow.getConditionCard(id);
      card.registerRunListener(runListener as any);
      if (autocomplete) {
        card
          .getArgument(autocomplete.arg)
          .registerAutocompleteListener(autocomplete.fn as any);
      }
    } catch (err) {
      this.error(`Failed to register condition card '${id}'`, err);
    }
  }

  private _registerActionCards(): void {
    const simple: Record<string, (d: MediaboxDevice) => Promise<void>> = {
      power_on: (d) => d.box.turnOn(),
      power_off: (d) => d.box.turnOff(),
      play: (d) => d.box.play(),
      pause: (d) => d.box.pause(),
      stop: (d) => d.box.stop(),
      channel_up: (d) => d.box.nextChannel(),
      channel_down: (d) => d.box.previousChannel(),
      record: (d) => d.box.record(),
      rewind: (d) => d.box.rewind(),
      fast_forward: (d) => d.box.fastForward(),
      skip_ad_break: async (d) => {
        await d.box.skipAdBreak();
      },
    };
    for (const [id, fn] of Object.entries(simple)) {
      this._action(id, async (args) => fn(args.device as MediaboxDevice));
    }

    this._action(
      'set_channel',
      async (args) => (args.device as MediaboxDevice).box.setChannelById(args.channel.id),
      {
        arg: 'channel',
        fn: (query, args) => (args.device as MediaboxDevice).getChannelAutocomplete(query),
      },
    );

    this._action('set_channel_number', async (args) =>
      (args.device as MediaboxDevice).box.setChannelByNumber(args.number),
    );

    this._action(
      'send_key',
      async (args) => (args.device as MediaboxDevice).box.sendKeyToBox(args.key.id),
      {
        arg: 'key',
        fn: (query) => {
          const q = (query || '').toLowerCase();
          return ALL_MEDIA_KEYS.filter((k) => k.toLowerCase().includes(q)).map(
            (k): AutocompleteItem => ({ name: k, id: k }),
          );
        },
      },
    );

    this._action('display_message', async (args) =>
      (args.device as MediaboxDevice).box.displayMessage('linear', args.message),
    );

    this._action(
      'play_recording',
      async (args) => (args.device as MediaboxDevice).box.playRecording(args.recording.id),
      {
        arg: 'recording',
        fn: (query, args) => (args.device as MediaboxDevice).getRecordingAutocomplete(query),
      },
    );

    this._action(
      'get_current_program',
      async (args) =>
        (args.device as MediaboxDevice).getCurrentProgram(args.channel.id, args.channel.name),
      {
        arg: 'channel',
        fn: (query, args) => (args.device as MediaboxDevice).getChannelAutocomplete(query),
      },
    );
  }

  private _registerConditionCards(): void {
    this._condition(
      'is_on',
      (args) => (args.device as MediaboxDevice).getCapabilityValue('onoff') === true,
    );
    this._condition(
      'is_playing',
      (args) => (args.device as MediaboxDevice).getCapabilityValue('speaker_playing') === true,
    );
    this._condition(
      'current_channel_is',
      (args) =>
        (args.device as MediaboxDevice).getCapabilityValue('mediabox_channel') ===
        args.channel.name,
      {
        arg: 'channel',
        fn: (query, args) => (args.device as MediaboxDevice).getChannelAutocomplete(query),
      },
    );
  }

  async onPair(session: PairSession): Promise<void> {
    let devices: Array<{ deviceId: string; name: string; platformType: string }> = [];
    let credentials: { username: string; password: string } | null = null;

    session.setHandler(
      'login',
      async (data: { username: string; password: string }): Promise<boolean> => {
        credentials = { username: data.username, password: data.password };
        const info = await this.app.probeAccount({
          countryCode: 'nl',
          username: data.username,
          password: data.password,
        });
        devices = info.boxes;
        return devices.length > 0;
      },
    );

    session.setHandler('list_devices', async () => {
      if (!credentials) throw new Error('Not logged in');
      return devices.map((d) => ({
        name: d.name,
        data: { id: d.deviceId },
        store: {
          countryCode: 'nl',
          username: credentials!.username,
          password: credentials!.password,
          platformType: d.platformType,
        },
      }));
    });
  }
}

module.exports = MediaboxDriver;
