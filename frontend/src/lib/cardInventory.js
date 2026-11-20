export function cardInventoryLabel(stats) {
  if (Number.isInteger(stats?.word_cards) && Number.isInteger(stats?.sentence_cards)) {
    return `${stats.word_cards} 个词 · ${stats.sentence_cards} 张句子卡`;
  }
  return Number.isInteger(stats?.total_cards) ? `共 ${stats.total_cards} 张卡` : "正在读取词库";
}
