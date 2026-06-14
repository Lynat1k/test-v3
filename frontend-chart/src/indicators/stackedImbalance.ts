import { IndicatorModule } from "./types";

export interface StackedImbalanceSettings {
  ratio: number;
}

export const stackedImbalanceIndicator: IndicatorModule & {
  defaultSettings: StackedImbalanceSettings;
  /**
   * Helper to check diagonal imbalances on cells using ratio settings.
   */
  isImbalance: (primaryVolume: number, comparativeVolume: number, ratio: number) => boolean;
} = {
  id: "stackedImbalance",
  label: "(PROCLUSTER) Stacked Imbalance",
  category: "Все индикаторы",
  type: "Оверлей",
  description: "Строит зоны последовательных рыночных дисбалансов (Stacked Imbalances) покупателей и продавцов на нескольких уровнях цены подряд.",
  details: "Показывает агрессивную рыночную однонаправленную инициативу. Складывание дисбалансов (например, когда рыночный спрос многократно превышает лимитное предложение 3 уровня подряд) образует сильнейшие зоны поддержки или сопротивления на будущее.",
  defaultSettings: {
    ratio: 3.0
  },
  isActiveDefault: false,

  isImbalance: (primaryVolume, comparativeVolume, ratio) => {
    return primaryVolume > comparativeVolume * ratio && primaryVolume > 0;
  }
};
