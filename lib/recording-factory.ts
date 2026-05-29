/** Factory for recordings (port of lghorizon_recording_factory.py). */

import {
  LGHorizonRecording,
  LGHorizonRecordingList,
  LGHorizonRecordingSeason,
  LGHorizonRecordingShow,
  LGHorizonRecordingSingle,
  LGHorizonRecordingType,
  LGHorizonShowRecordingList,
} from './models';

export class LGHorizonRecordingFactory {
  createRecordings(recordingJson: any): LGHorizonRecordingList {
    const list: LGHorizonRecording[] = [];
    for (const recording of recordingJson.data ?? []) {
      const typeStr = String(recording.type ?? 'unknown').toUpperCase();
      switch (typeStr) {
        case 'SINGLE':
          list.push(new LGHorizonRecordingSingle(recording));
          break;
        case 'SEASON':
          list.push(new LGHorizonRecordingSeason(recording));
          break;
        case 'SHOW':
          list.push(new LGHorizonRecordingShow(recording));
          break;
        default:
          // unknown -> skip
          break;
      }
    }
    return new LGHorizonRecordingList(list);
  }

  createEpisodes(episodeJson: any): LGHorizonShowRecordingList {
    const list: LGHorizonRecordingSingle[] = [];
    let showTitle: string | null = null;

    let showImage: string | null = null;
    if (episodeJson.images) {
      const images = episodeJson.images;
      const titleTreatment = images.find((img: any) => img?.type === 'titleTreatment');
      showImage = titleTreatment?.url ?? (images.length ? images[0].url : null);
    }

    for (const recording of episodeJson.data ?? []) {
      const single = new LGHorizonRecordingSingle(recording);
      if (showTitle === null) {
        showTitle = single.showTitle ?? single.title;
      }
      list.push(single);
    }
    return new LGHorizonShowRecordingList(showTitle, showImage, list);
  }
}
