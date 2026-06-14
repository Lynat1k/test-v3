import { IndicatorModule } from "./types";
import { ClusterCandle } from "../types";

export interface CvdSettings {
  smoothing: number;
}

export const cvdIndicator: IndicatorModule & {
  defaultSettings: CvdSettings;
  /**
   * Generates a cumulative delta array based on candles.
   */
  calculateCVD: (candles: ClusterCandle[]) => { value: number; timestamp: number }[];
} = {
  id: "cvd",
  label: "(PROCLUSTER) CVD",
  category: "Все индикаторы",
  type: "Подвальный",
  description: "Кумулятивная дельта объема (Cumulative Volume Delta), суммирующая значения дельты нарастающим итогом на протяжении всего графика.",
  details: "Используется для поиска рыночных скрытых дивергенций: например, если цена движется вверх к новым вершинам, а линия CVD падает, это признак сильного лимитного давления продавцов и скорого разворота цены вниз.",
  defaultSettings: {
    smoothing: 10
  },
  isActiveDefault: true,

  calculateCVD: (candles: ClusterCandle[]) => {
    let runningSum = 0;
    return candles.map((candle) => {
      runningSum += candle.delta;
      return {
        value: runningSum,
        timestamp: candle.timestamp
      };
    });
  }
};
