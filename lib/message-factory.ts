/** Factory for incoming MQTT messages (port of lghorizon_message_factory.py). */

import {
  LGHorizonMessage,
  LGHorizonMessageType,
  LGHorizonStatusMessage,
  LGHorizonUIStatusMessage,
  LGHorizonUnknownMessage,
} from './models';

export class LGHorizonMessageFactory {
  createMessage(topic: string, payload: Record<string, any>): LGHorizonMessage {
    switch (this.getMessageType(topic, payload)) {
      case LGHorizonMessageType.STATUS:
        return new LGHorizonStatusMessage(payload, topic);
      case LGHorizonMessageType.UI_STATUS:
        return new LGHorizonUIStatusMessage(payload, topic);
      default:
        return new LGHorizonUnknownMessage(payload, topic);
    }
  }

  private getMessageType(topic: string, payload: Record<string, any>): LGHorizonMessageType {
    if (topic.includes('status')) {
      return LGHorizonMessageType.STATUS;
    }
    if (payload.type === 'CPE.uiStatus') {
      return LGHorizonMessageType.UI_STATUS;
    }
    return LGHorizonMessageType.UNKNOWN;
  }
}
