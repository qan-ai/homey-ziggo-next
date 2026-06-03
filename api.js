'use strict';

module.exports = {
  async reconnect({ homey }) {
    return homey.app.reconnectAllAccounts();
  },
};
