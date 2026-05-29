'use strict';

import Homey from 'homey';
import type { PairSession } from 'homey/lib/Driver';
import type ZiggoNextApp from '../../app';

export default class RecordingsDriver extends Homey.Driver {
  async onInit(): Promise<void> {
    this.log('Recordings driver initialized');
  }

  private get app(): ZiggoNextApp {
    return this.homey.app as ZiggoNextApp;
  }

  async onPair(session: PairSession): Promise<void> {
    let householdId = '';
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
        householdId = info.householdId;
        return !!householdId;
      },
    );

    session.setHandler('list_devices', async () => {
      if (!credentials || !householdId) throw new Error('Not logged in');
      return [
        {
          name: this.homey.__('recordings.device_name'),
          data: { id: `recordings-${householdId}` },
          store: {
            countryCode: 'nl',
            username: credentials.username,
            password: credentials.password,
          },
        },
      ];
    });
  }
}

module.exports = RecordingsDriver;
